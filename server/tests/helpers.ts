import request from 'supertest';
import argon2 from 'argon2';
import { Role } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

export const app = createApp();

const ARGON_OPTS = { type: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/**
 * Wipe every table between test files.
 *
 * TRUNCATE ... CASCADE in one statement rather than a sequence of deleteMany
 * calls: the foreign keys mean order matters, and a hand-maintained order rots
 * the moment somebody adds a table. RESTART IDENTITY keeps sequences
 * predictable so order numbers start from SHOP-000001 in every file.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "OrderStatusEvent", "OrderItem", "Order",
      "CartItem", "Cart",
      "VariantOptionValue", "ProductOptionValue", "ProductOption",
      "ProductVariant", "ProductImage", "Product", "Category",
      "Address", "RefreshToken", "User"
    RESTART IDENTITY CASCADE
  `);
}

/**
 * A minimal but realistic product: two option axes, four variants, one of them
 * out of stock and one down to its last two. Enough to exercise variant
 * resolution, stock limits and the oversell guard without a full seed.
 */
export async function createTestProduct(overrides?: { slug?: string }) {
  const slug = overrides?.slug ?? 'test-tee';

  const category = await prisma.category.create({
    data: { slug: `cat-${slug}`, name: 'Test Category' },
  });

  const product = await prisma.product.create({
    data: {
      slug,
      title: 'Test Tee',
      description: 'A tee used by the test suite.',
      brand: 'Testwear',
      categoryId: category.id,
      images: {
        create: { url: 'data:image/svg+xml;base64,PHN2Zy8+', alt: 'Test tee', position: 0 },
      },
    },
  });

  const sizeOption = await prisma.productOption.create({
    data: { productId: product.id, name: 'Size', position: 0 },
  });
  const colourOption = await prisma.productOption.create({
    data: { productId: product.id, name: 'Colour', position: 1 },
  });

  const sizes = await Promise.all(
    ['S', 'M'].map((value, i) =>
      prisma.productOptionValue.create({ data: { optionId: sizeOption.id, value, position: i } }),
    ),
  );
  const colours = await Promise.all(
    ['Bone', 'Ink'].map((value, i) =>
      prisma.productOptionValue.create({ data: { optionId: colourOption.id, value, position: i } }),
    ),
  );

  const spec = [
    { size: 0, colour: 0, sku: `${slug}-S-BONE`, priceCents: 2500, stock: 10 },
    { size: 1, colour: 0, sku: `${slug}-M-BONE`, priceCents: 2500, stock: 2 },
    { size: 0, colour: 1, sku: `${slug}-S-INK`, priceCents: 2700, stock: 5 },
    { size: 1, colour: 1, sku: `${slug}-M-INK`, priceCents: 2700, stock: 0 },
  ];

  const variants = [];
  for (const v of spec) {
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: v.sku, priceCents: v.priceCents, stock: v.stock },
    });
    await prisma.variantOptionValue.createMany({
      data: [
        { variantId: variant.id, optionValueId: sizes[v.size]!.id },
        { variantId: variant.id, optionValueId: colours[v.colour]!.id },
      ],
    });
    variants.push(variant);
  }

  return { product, category, variants, bySku: new Map(variants.map((v) => [v.sku, v])) };
}

export async function createUser(email: string, password: string, role: Role = Role.CUSTOMER) {
  return prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await argon2.hash(password, ARGON_OPTS),
      name: email.split('@')[0] ?? 'Tester',
      role,
    },
  });
}

/**
 * A supertest agent keeps a cookie jar across requests, which is the only way
 * to test an httpOnly-cookie session honestly -- reaching into the response to
 * fish out a token would test a code path real browsers never take.
 */
export function agent() {
  return request.agent(app);
}

export async function signIn(email: string, password: string) {
  const a = agent();
  const res = await a.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`signIn failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return a;
}

export const SHIPPING = {
  fullName: 'Test Person',
  line1: '1 Test Street',
  city: 'Leeds',
  postalCode: 'LS1 1AA',
  country: 'GB',
};
