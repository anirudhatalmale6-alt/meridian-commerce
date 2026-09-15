import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { notFound } from '../../http/errors.js';

export const catalogRouter = Router();

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  // Prices cross the wire in MAJOR units because that is what a human types
  // into a filter box, and are converted to cents here -- one conversion, at
  // the boundary, so nothing downstream has to wonder which unit it holds.
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  inStock: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'title_asc']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  // Capped at 48. An uncapped page size lets one request ask for the entire
  // table and is the easiest way to knock the API over.
  perPage: z.coerce.number().int().min(1).max(48).default(12),
});

const productInclude = {
  category: true,
  images: { orderBy: { position: 'asc' } },
  options: {
    orderBy: { position: 'asc' },
    include: { values: { orderBy: { position: 'asc' } } },
  },
  variants: {
    where: { isActive: true },
    orderBy: { priceCents: 'asc' },
    include: { optionValues: { include: { optionValue: true } } },
  },
} satisfies Prisma.ProductInclude;

type ProductPayload = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

catalogRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const query = listQuery.parse(req.query);

    const minCents = query.minPrice !== undefined ? Math.round(query.minPrice * 100) : undefined;
    const maxCents = query.maxPrice !== undefined ? Math.round(query.maxPrice * 100) : undefined;

    // A variant-level predicate that every price/stock filter shares. Built
    // once so the WHERE clause and the "which variants do we show" logic can
    // never drift apart -- a product matching on a variant it then hides is a
    // confusing empty card.
    const variantWhere: Prisma.ProductVariantWhereInput = {
      isActive: true,
      ...(minCents !== undefined || maxCents !== undefined
        ? {
            priceCents: {
              ...(minCents !== undefined ? { gte: minCents } : {}),
              ...(maxCents !== undefined ? { lte: maxCents } : {}),
            },
          }
        : {}),
      ...(query.inStock === 'true' ? { stock: { gt: 0 } } : {}),
    };

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { brand: { contains: query.q, mode: 'insensitive' } },
              // SKU search, so staff can paste a code from an order and land
              // on the product.
              { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.brand ? { brand: { equals: query.brand, mode: 'insensitive' } } : {}),
      // `some` not `every`: a product qualifies if ANY of its variants matches
      // the price/stock filter. `every` would also match a product with no
      // variants at all, which is how empty products leak into results.
      variants: { some: variantWhere },
    };

    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      query.sort === 'title_asc'
        ? [{ title: 'asc' }]
        : query.sort === 'price_asc' || query.sort === 'price_desc'
          ? // Sorting a product by price means sorting by its cheapest variant,
            // which SQL cannot express through Prisma's relation ordering. It is
            // applied in-memory after the page is fetched; see the note below.
            [{ createdAt: 'desc' }]
          : [{ createdAt: 'desc' }];

    const [total, rows] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);

    let items = rows.map((row) => shapeProduct(row, variantWhere, query));

    if (query.sort === 'price_asc' || query.sort === 'price_desc') {
      // Honest about the limitation: this sorts the CURRENT PAGE, not the whole
      // result set, because the sort key lives on a child row. For a catalogue
      // of this size that is invisible; past a few thousand products the right
      // fix is a denormalised min_price_cents column on Product, maintained by
      // a trigger or in the same transaction as a variant write. Flagged rather
      // than hidden so nobody discovers it as a bug later.
      items = items.sort((a, b) =>
        query.sort === 'price_asc'
          ? a.priceFromCents - b.priceFromCents
          : b.priceFromCents - a.priceFromCents,
      );
    }

    res.json({
      items,
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      sortedWithinPageOnly: query.sort === 'price_asc' || query.sort === 'price_desc',
    });
  }),
);

catalogRouter.get(
  '/products/:slug',
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { slug: req.params.slug, isActive: true },
      include: productInclude,
    });
    if (!product) throw notFound('That product does not exist.');
    res.json({ product: shapeProduct(product, { isActive: true }, { sort: 'newest' }) });
  }),
);

catalogRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
    });
    res.json({
      categories: categories.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        productCount: c._count.products,
      })),
    });
  }),
);

catalogRouter.get(
  '/facets',
  asyncHandler(async (_req, res) => {
    const [brands, range] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, brand: { not: null } },
        distinct: ['brand'],
        select: { brand: true },
        orderBy: { brand: 'asc' },
      }),
      prisma.productVariant.aggregate({
        where: { isActive: true, product: { isActive: true } },
        _min: { priceCents: true },
        _max: { priceCents: true },
      }),
    ]);

    res.json({
      brands: brands.map((b) => b.brand).filter((b): b is string => Boolean(b)),
      // Nulls out of aggregate mean "no rows", which is 0 to a caller, not a
      // crash and not a missing key.
      minPriceCents: range._min.priceCents ?? 0,
      maxPriceCents: range._max.priceCents ?? 0,
    });
  }),
);

function shapeProduct(
  row: ProductPayload,
  variantWhere: Prisma.ProductVariantWhereInput,
  query: { sort: string },
) {
  void query;

  // Only variants that actually satisfy the active filter are surfaced, so a
  // card that matched a "under $30" search does not open onto a $90 default.
  const matching = row.variants.filter((v) => matchesVariantFilter(v, variantWhere));
  const shown = matching.length > 0 ? matching : row.variants;

  const prices = shown.map((v) => v.priceCents);
  const priceFromCents = prices.length ? Math.min(...prices) : 0;
  const priceToCents = prices.length ? Math.max(...prices) : 0;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    brand: row.brand,
    category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
    images: row.images.map((i) => ({ url: i.url, alt: i.alt })),
    options: row.options.map((o) => ({
      id: o.id,
      name: o.name,
      values: o.values.map((v) => ({ id: v.id, value: v.value })),
    })),
    variants: shown.map((v) => ({
      id: v.id,
      sku: v.sku,
      priceCents: v.priceCents,
      compareAtCents: v.compareAtCents,
      stock: v.stock,
      inStock: v.stock > 0,
      optionValueIds: v.optionValues.map((ov) => ov.optionValueId),
      label: v.optionValues.map((ov) => ov.optionValue.value).join(' / '),
    })),
    priceFromCents,
    priceToCents,
    // Aggregate stock across the variants on show, so a card can say
    // "out of stock" only when every option really is gone.
    totalStock: shown.reduce((sum, v) => sum + v.stock, 0),
    variantCount: shown.length,
  };
}

/**
 * Re-applies the same price/stock predicate in memory.
 *
 * This mirrors `variantWhere` deliberately: the database decides WHICH PRODUCTS
 * come back, and this decides WHICH VARIANTS of them are shown. Both have to
 * agree, so they are written from the same object rather than as two
 * independently maintained conditions.
 */
function matchesVariantFilter(
  variant: { priceCents: number; stock: number; isActive: boolean },
  where: Prisma.ProductVariantWhereInput,
): boolean {
  if (where.isActive === true && !variant.isActive) return false;

  const price = where.priceCents;
  if (price && typeof price === 'object') {
    const { gte, lte } = price as { gte?: number; lte?: number };
    if (gte !== undefined && variant.priceCents < gte) return false;
    if (lte !== undefined && variant.priceCents > lte) return false;
  }

  const stock = where.stock;
  if (stock && typeof stock === 'object') {
    const { gt } = stock as { gt?: number };
    if (gt !== undefined && variant.stock <= gt) return false;
  }

  return true;
}
