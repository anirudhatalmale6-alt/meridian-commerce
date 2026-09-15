import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { agent, createTestProduct, createUser, resetDatabase } from './helpers.js';
import { prisma } from '../src/prisma.js';
import { mergeGuestCartIntoUser } from '../src/modules/cart/cart.service.js';

let fixture: Awaited<ReturnType<typeof createTestProduct>>;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestProduct();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const sku = (s: string) => fixture.bySku.get(`test-tee-${s}`)!;

describe('guest cart', () => {
  it('persists across requests without any login', async () => {
    const a = agent();

    const added = await a
      .post('/api/cart/items')
      .send({ variantId: sku('S-BONE').id, quantity: 2 });
    expect(added.status).toBe(201);

    // A separate request, carrying only the cookie a browser would send back.
    const reread = await a.get('/api/cart');
    expect(reread.status).toBe(200);
    expect(reread.body.cart.itemCount).toBe(2);
    expect(reread.body.cart.subtotalCents).toBe(5000);
  });

  it('sums the line when the same variant is added twice', async () => {
    const a = agent();
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 2 });
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 3 });

    const cart = (await a.get('/api/cart')).body.cart;
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(5);
  });

  it('is isolated between two different visitors', async () => {
    const one = agent();
    const two = agent();

    await one.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });

    expect((await two.get('/api/cart')).body.cart.itemCount).toBe(0);
    expect((await one.get('/api/cart')).body.cart.itemCount).toBe(1);
  });

  it('derives the subtotal from the lines rather than storing it', async () => {
    const a = agent();
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 2 }); // 2 x 2500
    await a.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 }); // 1 x 2700

    const cart = (await a.get('/api/cart')).body.cart;
    expect(cart.subtotalCents).toBe(2 * 2500 + 2700);
    for (const line of cart.items) {
      expect(line.lineCents).toBe(line.unitCents * line.quantity);
    }

    // A price change is reflected on the next read, because nothing is cached.
    await prisma.productVariant.update({
      where: { id: sku('S-BONE').id },
      data: { priceCents: 3000 },
    });
    const after = (await a.get('/api/cart')).body.cart;
    expect(after.subtotalCents).toBe(2 * 3000 + 2700);
  });
});

describe('stock limits', () => {
  it('refuses more than the warehouse holds', async () => {
    const a = agent();
    const res = await a.post('/api/cart/items').send({ variantId: sku('M-BONE').id, quantity: 5 });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('Only 2');
    expect(res.body.error.details.available).toBe(2);
  });

  it('checks the increment against the resulting TOTAL, not the increment alone', async () => {
    const a = agent();
    // M-BONE has stock 2. Two single adds are each individually fine.
    expect(
      (await a.post('/api/cart/items').send({ variantId: sku('M-BONE').id, quantity: 2 })).status,
    ).toBe(201);

    // The third unit would make 3, which exceeds stock. A naive check that only
    // looks at the +1 would allow this.
    const third = await a
      .post('/api/cart/items')
      .send({ variantId: sku('M-BONE').id, quantity: 1 });
    expect(third.status).toBe(422);
  });

  it('refuses a sold-out variant outright', async () => {
    const a = agent();
    const res = await a.post('/api/cart/items').send({ variantId: sku('M-INK').id, quantity: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('out of stock');
  });

  it('404s an unknown variant instead of creating a phantom line', async () => {
    const a = agent();
    const res = await a.post('/api/cart/items').send({ variantId: 'no-such-variant', quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('will not add a variant belonging to a deactivated product', async () => {
    await prisma.product.update({ where: { id: fixture.product.id }, data: { isActive: false } });

    const a = agent();
    const res = await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
    expect(res.status).toBe(404);
  });
});

describe('editing a cart', () => {
  it('sets a quantity, and removes the line at zero', async () => {
    const a = agent();
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 4 });

    const lowered = await a.patch(`/api/cart/items/${sku('S-BONE').id}`).send({ quantity: 1 });
    expect(lowered.body.cart.items[0].quantity).toBe(1);

    const zeroed = await a.patch(`/api/cart/items/${sku('S-BONE').id}`).send({ quantity: 0 });
    expect(zeroed.body.cart.items).toHaveLength(0);
  });

  it('refuses a PATCH that would exceed stock', async () => {
    const a = agent();
    await a.post('/api/cart/items').send({ variantId: sku('M-BONE').id, quantity: 1 });

    const res = await a.patch(`/api/cart/items/${sku('M-BONE').id}`).send({ quantity: 50 });
    expect(res.status).toBe(422);
  });

  it('empties the whole cart on DELETE', async () => {
    const a = agent();
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
    await a.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });

    const cleared = await a.delete('/api/cart');
    expect(cleared.body.cart.items).toHaveLength(0);
    expect(cleared.body.cart.subtotalCents).toBe(0);
  });
});

/**
 * The merge is the part of a persistent cart that most often loses items, so it
 * gets its own block with every branch spelled out.
 */
describe('guest cart merging into an account', () => {
  it('follows the shopper through registration', async () => {
    const a = agent();
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 2 });

    const reg = await a
      .post('/api/auth/register')
      .send({ email: 'newcomer@test.local', password: 'Correct!Horse9', name: 'Newcomer' });
    expect(reg.status).toBe(201);

    const cart = (await a.get('/api/cart')).body.cart;
    expect(cart.itemCount).toBe(2);
  });

  it('SUMS an overlapping line instead of overwriting it', async () => {
    await createUser('summer@test.local', 'Correct!Horse9');

    // Two in the account already.
    const signedIn = agent();
    await signedIn
      .post('/api/auth/login')
      .send({ email: 'summer@test.local', password: 'Correct!Horse9' });
    await signedIn.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 2 });
    await signedIn.post('/api/auth/logout');

    // Three more added while signed out, same variant.
    const guest = agent();
    await guest.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 3 });
    await guest
      .post('/api/auth/login')
      .send({ email: 'summer@test.local', password: 'Correct!Horse9' });

    const cart = (await guest.get('/api/cart')).body.cart;
    expect(cart.items).toHaveLength(1);
    // 2 + 3, not 3 and not 2. An upsert with `update: { quantity }` gives 3.
    expect(cart.items[0].quantity).toBe(5);
  });

  it('keeps account-only lines and adds guest-only lines', async () => {
    await createUser('keeper@test.local', 'Correct!Horse9');

    const signedIn = agent();
    await signedIn
      .post('/api/auth/login')
      .send({ email: 'keeper@test.local', password: 'Correct!Horse9' });
    await signedIn.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });
    await signedIn.post('/api/auth/logout');

    const guest = agent();
    await guest.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
    await guest
      .post('/api/auth/login')
      .send({ email: 'keeper@test.local', password: 'Correct!Horse9' });

    const cart = (await guest.get('/api/cart')).body.cart;
    const skus = cart.items.map((i: { sku: string }) => i.sku).sort();
    expect(skus).toEqual(['test-tee-S-BONE', 'test-tee-S-INK']);
  });

  it('clamps a summed line to available stock rather than failing the login', async () => {
    await createUser('clamper@test.local', 'Correct!Horse9');

    // M-BONE has stock 2. Fill the account cart with both units.
    const signedIn = agent();
    await signedIn
      .post('/api/auth/login')
      .send({ email: 'clamper@test.local', password: 'Correct!Horse9' });
    await signedIn.post('/api/cart/items').send({ variantId: sku('M-BONE').id, quantity: 2 });
    await signedIn.post('/api/auth/logout');

    // And two more as a guest. The naive sum is 4, which does not exist.
    const guest = agent();
    await guest.post('/api/cart/items').send({ variantId: sku('M-BONE').id, quantity: 2 });

    const login = await guest
      .post('/api/auth/login')
      .send({ email: 'clamper@test.local', password: 'Correct!Horse9' });
    // Signing in must SUCCEED. The customer is logging in, not checking out.
    expect(login.status).toBe(200);

    const cart = (await guest.get('/api/cart')).body.cart;
    expect(cart.items[0].quantity).toBe(2);
  });

  it('drops a line whose variant was deactivated while the guest browsed', async () => {
    await createUser('dropper@test.local', 'Correct!Horse9');

    const guest = agent();
    await guest.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
    await guest.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });

    await prisma.productVariant.update({
      where: { id: sku('S-INK').id },
      data: { isActive: false },
    });

    await guest
      .post('/api/auth/login')
      .send({ email: 'dropper@test.local', password: 'Correct!Horse9' });

    const cart = (await guest.get('/api/cart')).body.cart;
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].sku).toBe('test-tee-S-BONE');
  });

  it('drops a line whose whole PRODUCT was deactivated, on both merge paths', async () => {
    await createUser('prod.drop.a@test.local', 'Correct!Horse9');
    await createUser('prod.drop.b@test.local', 'Correct!Horse9');

    // Path 1: the user has no cart yet, so the guest row is reassigned.
    const reassign = agent();
    await reassign.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });

    // Path 2: the user already has a cart, so items are merged one by one.
    const merge = agent();
    await merge
      .post('/api/auth/login')
      .send({ email: 'prod.drop.b@test.local', password: 'Correct!Horse9' });
    await merge.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });
    await merge.post('/api/auth/logout');
    await merge.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });

    // The variants stay active; only the product is pulled.
    await prisma.product.update({ where: { id: fixture.product.id }, data: { isActive: false } });

    await reassign
      .post('/api/auth/login')
      .send({ email: 'prod.drop.a@test.local', password: 'Correct!Horse9' });
    expect((await reassign.get('/api/cart')).body.cart.items).toHaveLength(0);

    await merge
      .post('/api/auth/login')
      .send({ email: 'prod.drop.b@test.local', password: 'Correct!Horse9' });
    // The guest line is dropped; the account's own line is left as it was --
    // the merge does not police lines it did not touch.
    const mergedCart = (await merge.get('/api/cart')).body.cart;
    expect(mergedCart.items.map((i: { sku: string }) => i.sku)).toEqual(['test-tee-S-INK']);
  });

  it('deletes the guest cart, so a stale cookie cannot resurrect it', async () => {
    await createUser('stale@test.local', 'Correct!Horse9');

    const a = agent();
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
    await a.post('/api/auth/login').send({ email: 'stale@test.local', password: 'Correct!Horse9' });
    expect((await a.get('/api/cart')).body.cart.itemCount).toBe(1);

    // Same browser, signed out again -- the guest cookie is still present.
    await a.post('/api/auth/logout');
    const cart = (await a.get('/api/cart')).body.cart;
    expect(cart.itemCount).toBe(0);

    const guestCarts = await prisma.cart.count({ where: { sessionId: { not: null } } });
    // The one that reappears is brand new and empty; the merged one is gone.
    expect(guestCarts).toBeLessThanOrEqual(1);
  });

  it('is a no-op when the guest never had a cart', async () => {
    const user = await createUser('empty@test.local', 'Correct!Horse9');
    // Called directly: an unknown session id must not throw.
    await expect(
      mergeGuestCartIntoUser('a-session-that-never-existed', user.id),
    ).resolves.toBeUndefined();
    await expect(mergeGuestCartIntoUser('', user.id)).resolves.toBeUndefined();
  });
});
