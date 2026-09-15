import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, createTestProduct, resetDatabase } from './helpers.js';
import { prisma } from '../src/prisma.js';

beforeAll(async () => {
  await resetDatabase();

  // Two products so filters have something to exclude, plus a deactivated one
  // that must never appear.
  await createTestProduct({ slug: 'test-tee' });
  const second = await createTestProduct({ slug: 'test-mug' });
  await prisma.product.update({
    where: { id: second.product.id },
    data: { title: 'Test Mug', brand: 'Mugco' },
  });

  const hidden = await createTestProduct({ slug: 'test-hidden' });
  await prisma.product.update({ where: { id: hidden.product.id }, data: { isActive: false } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('product listing', () => {
  it('is public and excludes deactivated products', async () => {
    const res = await request(app).get('/api/catalog/products');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i: { slug: string }) => i.slug)).not.toContain('test-hidden');
  });

  it('never leaks a price as a float', async () => {
    const res = await request(app).get('/api/catalog/products');
    for (const item of res.body.items) {
      expect(Number.isInteger(item.priceFromCents)).toBe(true);
      expect(Number.isInteger(item.priceToCents)).toBe(true);
      for (const v of item.variants) expect(Number.isInteger(v.priceCents)).toBe(true);
    }
  });

  it('reports a price range across variants', async () => {
    const res = await request(app).get('/api/catalog/products?q=Test Tee');
    const tee = res.body.items.find((i: { slug: string }) => i.slug === 'test-tee');
    // Variants are 2500 and 2700.
    expect(tee.priceFromCents).toBe(2500);
    expect(tee.priceToCents).toBe(2700);
  });

  it('searches title, brand and SKU', async () => {
    const byTitle = await request(app).get('/api/catalog/products?q=Mug');
    expect(byTitle.body.items.map((i: { slug: string }) => i.slug)).toContain('test-mug');

    const byBrand = await request(app).get('/api/catalog/products?q=Mugco');
    expect(byBrand.body.total).toBe(1);

    const bySku = await request(app).get('/api/catalog/products?q=test-tee-M-INK');
    expect(bySku.body.total).toBe(1);
    expect(bySku.body.items[0].slug).toBe('test-tee');
  });

  it('returns an empty page rather than an error for no matches', async () => {
    const res = await request(app).get('/api/catalog/products?q=zzzz-nothing-matches');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalPages).toBe(1);
  });

  it('filters by price and shows only the variants that match', async () => {
    // Under 26.00 excludes the 2700 Ink variants entirely.
    const res = await request(app).get('/api/catalog/products?maxPrice=26');
    const tee = res.body.items.find((i: { slug: string }) => i.slug === 'test-tee');

    expect(tee).toBeDefined();
    for (const v of tee.variants) expect(v.priceCents).toBeLessThanOrEqual(2600);
    // A card that matched on a cheap variant must not offer the dear one.
    expect(tee.variants.map((v: { sku: string }) => v.sku)).not.toContain('test-tee-S-INK');
  });

  it('filters to in-stock variants only', async () => {
    const res = await request(app).get('/api/catalog/products?inStock=true');
    const tee = res.body.items.find((i: { slug: string }) => i.slug === 'test-tee');

    // M-INK has stock 0 and must be gone from the shown variants.
    expect(tee.variants.map((v: { sku: string }) => v.sku)).not.toContain('test-tee-M-INK');
    for (const v of tee.variants) expect(v.stock).toBeGreaterThan(0);
  });

  it('filters by category slug', async () => {
    const res = await request(app).get('/api/catalog/products?category=cat-test-tee');
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].slug).toBe('test-tee');
  });

  it('paginates with a hard cap on perPage', async () => {
    const page1 = await request(app).get('/api/catalog/products?perPage=1&page=1');
    const page2 = await request(app).get('/api/catalog/products?perPage=1&page=2');

    expect(page1.body.items).toHaveLength(1);
    expect(page2.body.items).toHaveLength(1);
    expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
    expect(page1.body.totalPages).toBe(2);

    // An unbounded page size would let one request ask for the whole table.
    const greedy = await request(app).get('/api/catalog/products?perPage=100000');
    expect(greedy.status).toBe(400);
  });

  it('rejects a nonsense page number instead of returning junk', async () => {
    const res = await request(app).get('/api/catalog/products?page=0');
    expect(res.status).toBe(400);
  });

  it('exposes variant option ids so a picker can resolve a combination', async () => {
    const res = await request(app).get('/api/catalog/products/test-tee');
    const p = res.body.product;

    expect(p.options).toHaveLength(2);
    expect(p.options[0].name).toBe('Size');
    expect(p.options[1].name).toBe('Colour');

    // Every variant must name exactly one value per axis, or the frontend
    // cannot map a selection onto a variant.
    for (const v of p.variants) {
      expect(v.optionValueIds).toHaveLength(2);
    }

    const allValueIds = p.options.flatMap((o: { values: { id: string }[] }) =>
      o.values.map((v) => v.id),
    );
    for (const v of p.variants) {
      for (const id of v.optionValueIds) expect(allValueIds).toContain(id);
    }
  });

  it('marks a sold-out variant as such rather than hiding it', async () => {
    const res = await request(app).get('/api/catalog/products/test-tee');
    const soldOut = res.body.product.variants.find(
      (v: { sku: string }) => v.sku === 'test-tee-M-INK',
    );
    expect(soldOut).toBeDefined();
    expect(soldOut.inStock).toBe(false);
    expect(soldOut.stock).toBe(0);
  });

  it('404s a deactivated product by slug', async () => {
    const res = await request(app).get('/api/catalog/products/test-hidden');
    expect(res.status).toBe(404);
  });
});

describe('facets and categories', () => {
  it('reports the real price range over active products', async () => {
    const res = await request(app).get('/api/catalog/facets');
    expect(res.status).toBe(200);
    expect(res.body.minPriceCents).toBe(2500);
    expect(res.body.maxPriceCents).toBe(2700);
    expect(res.body.brands).toContain('Mugco');
  });

  it('counts only active products per category', async () => {
    const res = await request(app).get('/api/catalog/categories');
    const hiddenCategory = res.body.categories.find(
      (c: { slug: string }) => c.slug === 'cat-test-hidden',
    );
    // The category still exists, but its only product is deactivated.
    expect(hiddenCategory.productCount).toBe(0);
  });
});

describe('health endpoints', () => {
  it('/health reports the process, /ready reports the database', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.database).toBe('up');
  });

  it('404s an unknown route in the standard error shape', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
