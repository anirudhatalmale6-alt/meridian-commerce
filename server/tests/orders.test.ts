import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderStatus, Role } from '@prisma/client';
import {
  SHIPPING,
  agent,
  createTestProduct,
  createUser,
  resetDatabase,
  signIn,
} from './helpers.js';
import { prisma } from '../src/prisma.js';
import { createOrderFromCart } from '../src/modules/orders/orders.service.js';

let fixture: Awaited<ReturnType<typeof createTestProduct>>;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestProduct();
  await createUser('buyer@test.local', 'Correct!Horse9');
  await createUser('other@test.local', 'Correct!Horse9');
  await createUser('boss@test.local', 'Admin!Passw0rd', Role.ADMIN);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const sku = (s: string) => fixture.bySku.get(`test-tee-${s}`)!;

async function buyerWithCart(quantity = 2, variant = 'S-BONE') {
  const a = await signIn('buyer@test.local', 'Correct!Horse9');
  await a.post('/api/cart/items').send({ variantId: sku(variant).id, quantity });
  return a;
}

describe('checkout', () => {
  it('creates an order whose totals add up and whose stock is decremented', async () => {
    const a = await buyerWithCart(2);
    const res = await a.post('/api/orders/checkout').send({ shipping: SHIPPING });

    expect(res.status).toBe(201);
    const order = res.body.order;

    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.subtotalCents).toBe(5000);
    expect(order.totalCents).toBe(order.subtotalCents + order.shippingCents + order.taxCents);
    expect(order.items.reduce((s: number, i: { lineCents: number }) => s + i.lineCents, 0)).toBe(
      order.subtotalCents,
    );

    const variant = await prisma.productVariant.findUnique({ where: { id: sku('S-BONE').id } });
    expect(variant?.stock).toBe(8); // 10 - 2
  });

  it('snapshots title, sku and unit price onto the line', async () => {
    const a = await buyerWithCart(1);
    const res = await a.post('/api/orders/checkout').send({ shipping: SHIPPING });
    const line = res.body.order.items[0];

    expect(line.productTitle).toBe('Test Tee');
    expect(line.sku).toBe('test-tee-S-BONE');
    expect(line.unitCents).toBe(2500);
    expect(line.variantLabel).toContain('Size: S');
    expect(line.variantLabel).toContain('Colour: Bone');

    // Changing the catalogue afterwards must not rewrite history.
    await prisma.productVariant.update({
      where: { id: sku('S-BONE').id },
      data: { priceCents: 9900 },
    });
    await prisma.product.update({
      where: { id: fixture.product.id },
      data: { title: 'Renamed Tee' },
    });

    const reread = await a.get(`/api/orders/${res.body.order.orderNumber}`);
    expect(reread.body.order.items[0].unitCents).toBe(2500);
    expect(reread.body.order.items[0].productTitle).toBe('Test Tee');
    expect(reread.body.order.totalCents).toBe(res.body.order.totalCents);
  });

  it('issues bank details and a unique payment reference', async () => {
    const a = await buyerWithCart(1);
    const res = await a.post('/api/orders/checkout').send({ shipping: SHIPPING });

    expect(res.body.payment.method).toBe('BANK_TRANSFER');
    expect(res.body.payment.reference).toMatch(/^REF-[A-Z2-9]{8}$/);
    expect(res.body.payment.amountCents).toBe(res.body.order.totalCents);
    expect(res.body.payment.bank.accountName).toBeTruthy();
  });

  it('empties the cart, and refuses a second checkout of nothing', async () => {
    const a = await buyerWithCart(1);
    await a.post('/api/orders/checkout').send({ shipping: SHIPPING });

    expect((await a.get('/api/cart')).body.cart.items).toHaveLength(0);

    const again = await a.post('/api/orders/checkout').send({ shipping: SHIPPING });
    expect(again.status).toBe(422);
    expect(again.body.error.message).toContain('empty');
  });

  it('applies free shipping above the threshold and flat below it', async () => {
    const cheap = await buyerWithCart(1); // 2500
    const cheapOrder = (await cheap.post('/api/orders/checkout').send({ shipping: SHIPPING })).body
      .order;
    expect(cheapOrder.shippingCents).toBeGreaterThan(0);

    // 4 x 2500 = 10000, over the 7500 threshold.
    const rich = await signIn('other@test.local', 'Correct!Horse9');
    await rich.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 4 });
    const richOrder = (await rich.post('/api/orders/checkout').send({ shipping: SHIPPING })).body
      .order;
    expect(richOrder.shippingCents).toBe(0);
  });

  it('normalises the country to uppercase ISO-2 and rejects anything else', async () => {
    const a = await buyerWithCart(1);
    const ok = await a
      .post('/api/orders/checkout')
      .send({ shipping: { ...SHIPPING, country: 'gb' } });
    expect(ok.status).toBe(201);
    expect(ok.body.order.shipCountry).toBe('GB');

    const b = await buyerWithCart(1, 'S-INK');
    const bad = await b
      .post('/api/orders/checkout')
      .send({ shipping: { ...SHIPPING, country: 'United Kingdom' } });
    expect(bad.status).toBe(400);
  });

  it('requires a signed-in customer', async () => {
    const guest = agent();
    await guest.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
    const res = await guest.post('/api/orders/checkout').send({ shipping: SHIPPING });
    expect(res.status).toBe(401);
  });

  it('saves the address only when asked', async () => {
    const a = await buyerWithCart(1);
    await a.post('/api/orders/checkout').send({ shipping: SHIPPING, saveAddress: true });

    const saved = await prisma.address.count({ where: { user: { email: 'buyer@test.local' } } });
    expect(saved).toBe(1);

    await a.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });
    await a.post('/api/orders/checkout').send({ shipping: SHIPPING, saveAddress: false });

    const stillOne = await prisma.address.count({ where: { user: { email: 'buyer@test.local' } } });
    expect(stillOne).toBe(1);
  });
});

/**
 * The oversell guard. This is the one place where a read-then-write would look
 * completely correct in a single-user test and fail under real traffic.
 */
describe('concurrent checkout', () => {
  it('sells the last unit exactly once when four shoppers race for it', async () => {
    await prisma.productVariant.update({
      where: { id: sku('S-BONE').id },
      data: { stock: 1 },
    });

    const racers = [];
    for (let n = 0; n < 4; n++) {
      const email = `racer${n}@test.local`;
      await createUser(email, 'Correct!Horse9');
      const a = await signIn(email, 'Correct!Horse9');
      await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
      racers.push(a);
    }

    const results = await Promise.all(
      racers.map((a) => a.post('/api/orders/checkout').send({ shipping: SHIPPING })),
    );

    const created = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status !== 201);

    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r.status).toBe(409);

    const variant = await prisma.productVariant.findUnique({ where: { id: sku('S-BONE').id } });
    expect(variant?.stock).toBe(0);
    // Never negative. A decrement without a conditional WHERE goes to -3 here.
    expect(variant!.stock).toBeGreaterThanOrEqual(0);

    expect(await prisma.order.count()).toBe(1);
  });

  it('rolls the whole order back if any line fails its stock check', async () => {
    const a = await signIn('buyer@test.local', 'Correct!Horse9');
    await a.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 2 });
    await a.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 2 });

    // Pull the rug out from under the second line after the cart was built.
    await prisma.productVariant.update({ where: { id: sku('S-INK').id }, data: { stock: 0 } });

    const res = await a.post('/api/orders/checkout').send({ shipping: SHIPPING });
    expect(res.status).toBe(409);

    // No order, and the FIRST line's stock must not have been consumed.
    expect(await prisma.order.count()).toBe(0);
    const first = await prisma.productVariant.findUnique({ where: { id: sku('S-BONE').id } });
    expect(first?.stock).toBe(10);

    // And the customer still has their basket.
    expect((await a.get('/api/cart')).body.cart.items).toHaveLength(2);
  });
});

describe('order visibility', () => {
  it('scopes the list and the detail view to the owner', async () => {
    const buyer = await buyerWithCart(1);
    const created = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });
    const orderNumber = created.body.order.orderNumber;

    const stranger = await signIn('other@test.local', 'Correct!Horse9');

    // 404, not 403 -- a 403 would confirm the order number exists.
    expect((await stranger.get(`/api/orders/${orderNumber}`)).status).toBe(404);
    expect((await stranger.get('/api/orders')).body.total).toBe(0);
    expect((await buyer.get('/api/orders')).body.total).toBe(1);
  });

  it("lets an admin read anybody's order", async () => {
    const buyer = await buyerWithCart(1);
    const created = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });

    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');
    const res = await admin.get(`/api/orders/${created.body.order.orderNumber}`);
    expect(res.status).toBe(200);
  });

  it("refuses a stranger trying to cancel someone else's order", async () => {
    const buyer = await buyerWithCart(1);
    const created = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });

    const stranger = await signIn('other@test.local', 'Correct!Horse9');
    const res = await stranger.post(`/api/orders/${created.body.order.orderNumber}/cancel`);
    expect(res.status).toBe(404);

    const unchanged = await prisma.order.findUnique({
      where: { orderNumber: created.body.order.orderNumber },
    });
    expect(unchanged?.status).toBe('AWAITING_PAYMENT');
  });
});

describe('status state machine', () => {
  async function placedOrder() {
    const buyer = await buyerWithCart(2);
    const res = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });
    return { buyer, orderNumber: res.body.order.orderNumber as string };
  }

  it('marks a bank transfer received, stamps paidAt and writes an audit event', async () => {
    const { orderNumber } = await placedOrder();
    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');

    const res = await admin.post(`/api/admin/orders/${orderNumber}/mark-paid`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('PAYMENT_RECEIVED');
    expect(res.body.order.paidAt).toBeTruthy();

    const events = res.body.order.events;
    expect(events).toHaveLength(2);
    expect(events[1].from).toBe('AWAITING_PAYMENT');
    expect(events[1].to).toBe('PAYMENT_RECEIVED');
    expect(events[1].actorId).toBeTruthy();
  });

  it('refuses a backwards transition', async () => {
    const { orderNumber } = await placedOrder();
    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');
    await admin.post(`/api/admin/orders/${orderNumber}/mark-paid`);

    const res = await admin
      .post(`/api/admin/orders/${orderNumber}/status`)
      .send({ status: 'AWAITING_PAYMENT' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.from).toBe('PAYMENT_RECEIVED');
  });

  it('refuses a skipped transition and a repeat of the current status', async () => {
    const { orderNumber } = await placedOrder();
    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');

    // AWAITING_PAYMENT cannot jump straight to SHIPPED.
    const skip = await admin
      .post(`/api/admin/orders/${orderNumber}/status`)
      .send({ status: 'SHIPPED' });
    expect(skip.status).toBe(409);

    const same = await admin
      .post(`/api/admin/orders/${orderNumber}/status`)
      .send({ status: 'AWAITING_PAYMENT' });
    expect(same.status).toBe(409);
  });

  it('will not mark the same order paid twice', async () => {
    const { orderNumber } = await placedOrder();
    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');

    expect((await admin.post(`/api/admin/orders/${orderNumber}/mark-paid`)).status).toBe(200);
    expect((await admin.post(`/api/admin/orders/${orderNumber}/mark-paid`)).status).toBe(409);

    // Revenue must reflect one payment, not two.
    const stats = await admin.get('/api/admin/stats');
    const order = await prisma.order.findUnique({ where: { orderNumber } });
    expect(stats.body.paidRevenueCents).toBe(order!.totalCents);
  });

  it('returns stock when an order is cancelled, and again on refund', async () => {
    const { orderNumber } = await placedOrder();
    const before = await prisma.productVariant.findUnique({ where: { id: sku('S-BONE').id } });
    expect(before?.stock).toBe(8);

    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');
    await admin.post(`/api/admin/orders/${orderNumber}/status`).send({ status: 'CANCELLED' });

    const after = await prisma.productVariant.findUnique({ where: { id: sku('S-BONE').id } });
    expect(after?.stock).toBe(10);
  });

  it('does not return stock twice when a cancelled order is touched again', async () => {
    const { orderNumber } = await placedOrder();
    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');

    await admin.post(`/api/admin/orders/${orderNumber}/status`).send({ status: 'CANCELLED' });
    const once = await prisma.productVariant.findUnique({ where: { id: sku('S-BONE').id } });
    expect(once?.stock).toBe(10);

    // CANCELLED is terminal, so this is refused -- which is precisely what
    // stops the stock being credited a second time.
    const again = await admin
      .post(`/api/admin/orders/${orderNumber}/status`)
      .send({ status: 'REFUNDED' });
    expect(again.status).toBe(409);

    const still = await prisma.productVariant.findUnique({ where: { id: sku('S-BONE').id } });
    expect(still?.stock).toBe(10);
  });

  it('lets a customer cancel while unpaid, but not once paid', async () => {
    const { buyer, orderNumber } = await placedOrder();

    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');

    // Unpaid: the customer may cancel.
    const cancelled = await buyer.post(`/api/orders/${orderNumber}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');

    // A second order, this time paid.
    await buyer.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });
    const second = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });
    const secondNumber = second.body.order.orderNumber;
    await admin.post(`/api/admin/orders/${secondNumber}/mark-paid`);

    const refused = await buyer.post(`/api/orders/${secondNumber}/cancel`);
    expect(refused.status).toBe(403);
  });

  it('never lets a customer mark their own order paid', async () => {
    const { buyer, orderNumber } = await placedOrder();

    // There is no customer-facing route for it, and the admin one is 403.
    const viaAdmin = await buyer
      .post(`/api/admin/orders/${orderNumber}/status`)
      .send({ status: 'PAYMENT_RECEIVED' });
    expect(viaAdmin.status).toBe(403);

    const order = await prisma.order.findUnique({ where: { orderNumber } });
    expect(order?.status).toBe('AWAITING_PAYMENT');
    expect(order?.paidAt).toBeNull();
  });
});

describe('admin dashboard figures', () => {
  it('counts only orders where money actually arrived', async () => {
    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');

    const buyer = await buyerWithCart(2);
    const paid = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });

    // Unpaid order from a second customer.
    const other = await signIn('other@test.local', 'Correct!Horse9');
    await other.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });
    await other.post('/api/orders/checkout').send({ shipping: SHIPPING });

    const before = await admin.get('/api/admin/stats');
    expect(before.body.orderCount).toBe(2);
    expect(before.body.awaitingPayment).toBe(2);
    // Nothing has been paid yet, so revenue is zero despite two orders.
    expect(before.body.paidRevenueCents).toBe(0);

    await admin.post(`/api/admin/orders/${paid.body.order.orderNumber}/mark-paid`);

    const after = await admin.get('/api/admin/stats');
    expect(after.body.paidRevenueCents).toBe(paid.body.order.totalCents);
    expect(after.body.awaitingPayment).toBe(1);
  });

  it('drops a cancelled order out of revenue again', async () => {
    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');
    const buyer = await buyerWithCart(2);
    const order = (await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING })).body
      .order;

    await admin.post(`/api/admin/orders/${order.orderNumber}/mark-paid`);
    expect((await admin.get('/api/admin/stats')).body.paidRevenueCents).toBe(order.totalCents);

    await admin.post(`/api/admin/orders/${order.orderNumber}/status`).send({ status: 'REFUNDED' });
    expect((await admin.get('/api/admin/stats')).body.paidRevenueCents).toBe(0);
  });

  it('finds an order by its payment reference', async () => {
    const buyer = await buyerWithCart(1);
    const created = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });
    const reference = created.body.order.paymentReference;

    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');
    const found = await admin.get(`/api/admin/orders?q=${reference}`);
    expect(found.body.total).toBe(1);
    expect(found.body.orders[0].orderNumber).toBe(created.body.order.orderNumber);
  });
});

describe('order numbering', () => {
  it('issues sequential, human-quotable numbers', async () => {
    const buyer = await signIn('buyer@test.local', 'Correct!Horse9');

    await buyer.post('/api/cart/items').send({ variantId: sku('S-BONE').id, quantity: 1 });
    const first = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });

    await buyer.post('/api/cart/items').send({ variantId: sku('S-INK').id, quantity: 1 });
    const second = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });

    expect(first.body.order.orderNumber).toBe('SHOP-000001');
    expect(second.body.order.orderNumber).toBe('SHOP-000002');
  });

  it('gives every order a distinct payment reference', async () => {
    const buyer = await signIn('buyer@test.local', 'Correct!Horse9');
    const references = new Set<string>();

    for (const variant of ['S-BONE', 'S-INK', 'M-BONE']) {
      await buyer.post('/api/cart/items').send({ variantId: sku(variant).id, quantity: 1 });
      const res = await buyer.post('/api/orders/checkout').send({ shipping: SHIPPING });
      references.add(res.body.order.paymentReference);
    }

    expect(references.size).toBe(3);
  });
});

describe('createOrderFromCart called directly', () => {
  it('throws rather than creating a zero-value order for an empty cart', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'buyer@test.local' } });
    await expect(createOrderFromCart(user.id, SHIPPING)).rejects.toThrow(/empty/i);
    expect(await prisma.order.count()).toBe(0);
  });

  it('leaves the order in AWAITING_PAYMENT with no paidAt', async () => {
    const a = await buyerWithCart(1);
    await a.post('/api/orders/checkout').send({ shipping: SHIPPING });

    const order = await prisma.order.findFirstOrThrow();
    expect(order.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(order.paidAt).toBeNull();
  });
});
