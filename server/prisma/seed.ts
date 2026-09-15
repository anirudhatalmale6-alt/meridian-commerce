/**
 * Seed data. Idempotent -- safe to re-run; it upserts by slug/email/sku rather
 * than blindly inserting, so `npm run seed` twice does not double the catalogue.
 *
 * The product set is deliberately varied: single-variant items, two-axis
 * variants (size x colour), one product fully out of stock, one variant with a
 * compare-at price, and a couple of low-stock lines. That way the frontend and
 * the tests exercise the interesting states instead of twelve identical rows.
 */
import argon2 from 'argon2';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

const ARGON_OPTS = { type: 2 as const, memoryCost: 65_536, timeCost: 3, parallelism: 1 };

// A deterministic picture per product without shipping binaries in the repo or
// hotlinking a CDN that may vanish. Inline SVG as a data URI renders offline,
// costs no request, and cannot 404 on the client's staging box.
function placeholder(label: string, from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
</linearGradient></defs>
<rect width="800" height="800" fill="url(#g)"/>
<text x="400" y="420" font-family="Georgia,serif" font-size="64" fill="rgba(255,255,255,0.92)" text-anchor="middle">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

interface SeedVariant {
  sku: string;
  priceCents: number;
  compareAtCents?: number;
  stock: number;
  options: Record<string, string>;
}

interface SeedProduct {
  slug: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  swatch: [string, string];
  badge: string;
  options: { name: string; values: string[] }[];
  variants: SeedVariant[];
}

const CATEGORIES = [
  { slug: 'drinkware', name: 'Drinkware' },
  { slug: 'apparel', name: 'Apparel' },
  { slug: 'desk', name: 'Desk & Office' },
  { slug: 'bags', name: 'Bags' },
  { slug: 'lighting', name: 'Lighting' },
];

const PRODUCTS: SeedProduct[] = [
  {
    slug: 'harbour-pour-over-kettle',
    title: 'Harbour Pour-Over Kettle',
    description:
      'A 1L gooseneck kettle with a counterweighted handle and a spout that pours a pencil-thin stream. Brushed stainless body, induction-ready base, and a lid that actually stays on when you tip it.',
    brand: 'Harbour',
    category: 'drinkware',
    swatch: ['#1f2937', '#4b5563'],
    badge: 'Kettle',
    options: [{ name: 'Finish', values: ['Brushed Steel', 'Matte Black'] }],
    variants: [
      { sku: 'HAR-KET-STL', priceCents: 6900, stock: 24, options: { Finish: 'Brushed Steel' } },
      {
        sku: 'HAR-KET-BLK',
        priceCents: 7400,
        compareAtCents: 8900,
        stock: 11,
        options: { Finish: 'Matte Black' },
      },
    ],
  },
  {
    slug: 'meridian-everyday-tee',
    title: 'Meridian Everyday Tee',
    description:
      'Heavyweight 240gsm combed cotton, pre-shrunk, with a ribbed collar that survives the wash. Cut slightly boxy through the body and hemmed a touch long so it stays put when you reach.',
    brand: 'Meridian',
    category: 'apparel',
    swatch: ['#0f766e', '#115e59'],
    badge: 'Tee',
    options: [
      { name: 'Size', values: ['S', 'M', 'L', 'XL'] },
      { name: 'Colour', values: ['Bone', 'Ink', 'Moss'] },
    ],
    variants: [
      { sku: 'MER-TEE-S-BONE', priceCents: 3200, stock: 8, options: { Size: 'S', Colour: 'Bone' } },
      {
        sku: 'MER-TEE-M-BONE',
        priceCents: 3200,
        stock: 15,
        options: { Size: 'M', Colour: 'Bone' },
      },
      { sku: 'MER-TEE-L-BONE', priceCents: 3200, stock: 2, options: { Size: 'L', Colour: 'Bone' } },
      {
        sku: 'MER-TEE-XL-BONE',
        priceCents: 3400,
        stock: 0,
        options: { Size: 'XL', Colour: 'Bone' },
      },
      { sku: 'MER-TEE-S-INK', priceCents: 3200, stock: 12, options: { Size: 'S', Colour: 'Ink' } },
      { sku: 'MER-TEE-M-INK', priceCents: 3200, stock: 19, options: { Size: 'M', Colour: 'Ink' } },
      { sku: 'MER-TEE-L-INK', priceCents: 3200, stock: 7, options: { Size: 'L', Colour: 'Ink' } },
      { sku: 'MER-TEE-XL-INK', priceCents: 3400, stock: 4, options: { Size: 'XL', Colour: 'Ink' } },
      { sku: 'MER-TEE-M-MOSS', priceCents: 3300, stock: 6, options: { Size: 'M', Colour: 'Moss' } },
      { sku: 'MER-TEE-L-MOSS', priceCents: 3300, stock: 3, options: { Size: 'L', Colour: 'Moss' } },
    ],
  },
  {
    slug: 'atlas-walnut-desk-tray',
    title: 'Atlas Walnut Desk Tray',
    description:
      'Solid American walnut, hand-oiled, with a felt-lined base that will not scuff a desk. Sized to take a passport, a phone and a set of keys without anything sliding around.',
    brand: 'Atlas',
    category: 'desk',
    swatch: ['#92400e', '#78350f'],
    badge: 'Tray',
    options: [{ name: 'Size', values: ['Small', 'Large'] }],
    variants: [
      { sku: 'ATL-TRY-SM', priceCents: 4200, stock: 30, options: { Size: 'Small' } },
      { sku: 'ATL-TRY-LG', priceCents: 5800, stock: 17, options: { Size: 'Large' } },
    ],
  },
  {
    slug: 'kestrel-weekender-holdall',
    title: 'Kestrel Weekender Holdall',
    description:
      '18oz waxed canvas with bridle leather handles and a YKK zip that runs the full length of the opening. Carries three days of clothes and fits an overhead bin without a fight.',
    brand: 'Kestrel',
    category: 'bags',
    swatch: ['#1e3a8a', '#1e40af'],
    badge: 'Holdall',
    options: [{ name: 'Colour', values: ['Field Tan', 'Slate', 'Olive'] }],
    variants: [
      {
        sku: 'KES-HLD-TAN',
        priceCents: 18500,
        compareAtCents: 21000,
        stock: 5,
        options: { Colour: 'Field Tan' },
      },
      { sku: 'KES-HLD-SLT', priceCents: 18500, stock: 9, options: { Colour: 'Slate' } },
      { sku: 'KES-HLD-OLV', priceCents: 18500, stock: 1, options: { Colour: 'Olive' } },
    ],
  },
  {
    slug: 'lumen-task-lamp',
    title: 'Lumen Task Lamp',
    description:
      'Die-cast aluminium arm with a friction joint that holds position without tightening, and a 2700-4000K dimmable head. Draws 9W at full output and has a USB-C port in the base.',
    brand: 'Lumen',
    category: 'lighting',
    swatch: ['#b45309', '#d97706'],
    badge: 'Lamp',
    options: [{ name: 'Colour', values: ['Chalk', 'Graphite'] }],
    variants: [
      { sku: 'LUM-LMP-CHK', priceCents: 12900, stock: 14, options: { Colour: 'Chalk' } },
      { sku: 'LUM-LMP-GRA', priceCents: 12900, stock: 6, options: { Colour: 'Graphite' } },
    ],
  },
  {
    slug: 'harbour-double-wall-tumbler',
    title: 'Harbour Double-Wall Tumbler',
    description:
      'Borosilicate inner and outer wall, so it holds heat without burning your hand and will not sweat onto a desk. Dishwasher safe on the top rack, 350ml to the line.',
    brand: 'Harbour',
    category: 'drinkware',
    swatch: ['#0e7490', '#0891b2'],
    badge: 'Tumbler',
    options: [{ name: 'Capacity', values: ['250ml', '350ml'] }],
    variants: [
      { sku: 'HAR-TUM-250', priceCents: 1800, stock: 48, options: { Capacity: '250ml' } },
      { sku: 'HAR-TUM-350', priceCents: 2200, stock: 36, options: { Capacity: '350ml' } },
    ],
  },
  {
    slug: 'meridian-merino-beanie',
    title: 'Meridian Merino Beanie',
    description:
      'Fine-gauge 19.5-micron merino, knitted in a single tube so there is no seam to sit on your forehead. Warm without itch, and it packs down into a jacket pocket.',
    brand: 'Meridian',
    category: 'apparel',
    swatch: ['#4c1d95', '#5b21b6'],
    badge: 'Beanie',
    options: [{ name: 'Colour', values: ['Charcoal', 'Rust'] }],
    variants: [
      // Deliberately sold out in every option, so the UI's out-of-stock path
      // is exercised by the seed rather than only in a test.
      { sku: 'MER-BNE-CHR', priceCents: 2800, stock: 0, options: { Colour: 'Charcoal' } },
      { sku: 'MER-BNE-RST', priceCents: 2800, stock: 0, options: { Colour: 'Rust' } },
    ],
  },
  {
    slug: 'atlas-leather-cable-wrap',
    title: 'Atlas Leather Cable Wrap',
    description:
      'Vegetable-tanned leather with a brass press stud. Holds a charger and cable in a bundle that will not unravel in a bag. Darkens with use, which is the point.',
    brand: 'Atlas',
    category: 'desk',
    swatch: ['#7c2d12', '#9a3412'],
    badge: 'Wrap',
    options: [{ name: 'Pack', values: ['Single', 'Pack of 3'] }],
    variants: [
      { sku: 'ATL-CBL-1', priceCents: 1400, stock: 62, options: { Pack: 'Single' } },
      {
        sku: 'ATL-CBL-3',
        priceCents: 3600,
        compareAtCents: 4200,
        stock: 21,
        options: { Pack: 'Pack of 3' },
      },
    ],
  },
  {
    slug: 'kestrel-day-pack-22l',
    title: 'Kestrel Day Pack 22L',
    description:
      'Ripstop nylon with a padded 16-inch laptop sleeve that sits against your back, not against the contents. Water-resistant base panel and a drawcord top under the lid.',
    brand: 'Kestrel',
    category: 'bags',
    swatch: ['#374151', '#4b5563'],
    badge: 'Day Pack',
    options: [{ name: 'Colour', values: ['Black', 'Sand'] }],
    variants: [
      { sku: 'KES-DPK-BLK', priceCents: 9800, stock: 23, options: { Colour: 'Black' } },
      { sku: 'KES-DPK-SND', priceCents: 9800, stock: 2, options: { Colour: 'Sand' } },
    ],
  },
  {
    slug: 'lumen-clip-reading-light',
    title: 'Lumen Clip Reading Light',
    description:
      'A 40-lumen clip light with a silicone-lined jaw that grips a hardback without marking it. Three brightness steps, roughly 30 hours on the lowest, charges over USB-C.',
    brand: 'Lumen',
    category: 'lighting',
    swatch: ['#065f46', '#047857'],
    badge: 'Clip Light',
    options: [{ name: 'Colour', values: ['White', 'Black'] }],
    variants: [
      { sku: 'LUM-CLP-WHT', priceCents: 2400, stock: 41, options: { Colour: 'White' } },
      { sku: 'LUM-CLP-BLK', priceCents: 2400, stock: 33, options: { Colour: 'Black' } },
    ],
  },
  {
    slug: 'harbour-hand-grinder',
    title: 'Harbour Hand Grinder',
    description:
      'Conical stainless burrs with 38 click-stops from espresso to French press. Folding handle, and the catch cup holds 30g so a full dose fits in one go.',
    brand: 'Harbour',
    category: 'drinkware',
    swatch: ['#3f3f46', '#52525b'],
    badge: 'Grinder',
    options: [{ name: 'Burr', values: ['Standard', 'Espresso'] }],
    variants: [
      { sku: 'HAR-GRD-STD', priceCents: 8900, stock: 16, options: { Burr: 'Standard' } },
      { sku: 'HAR-GRD-ESP', priceCents: 10900, stock: 3, options: { Burr: 'Espresso' } },
    ],
  },
  {
    slug: 'atlas-a5-notebook',
    title: 'Atlas A5 Notebook',
    description:
      '120gsm cream paper that takes a fountain pen without feathering, lay-flat binding, and 192 pages. Dot grid at 5mm, with a ribbon marker and an elastic closure.',
    brand: 'Atlas',
    category: 'desk',
    swatch: ['#155e75', '#0e7490'],
    badge: 'Notebook',
    options: [
      { name: 'Ruling', values: ['Dot Grid', 'Plain'] },
      { name: 'Cover', values: ['Navy', 'Oxblood'] },
    ],
    variants: [
      {
        sku: 'ATL-NBK-DOT-NVY',
        priceCents: 1900,
        stock: 55,
        options: { Ruling: 'Dot Grid', Cover: 'Navy' },
      },
      {
        sku: 'ATL-NBK-DOT-OXB',
        priceCents: 1900,
        stock: 28,
        options: { Ruling: 'Dot Grid', Cover: 'Oxblood' },
      },
      {
        sku: 'ATL-NBK-PLN-NVY',
        priceCents: 1900,
        stock: 31,
        options: { Ruling: 'Plain', Cover: 'Navy' },
      },
      {
        sku: 'ATL-NBK-PLN-OXB',
        priceCents: 1900,
        stock: 0,
        options: { Ruling: 'Plain', Cover: 'Oxblood' },
      },
    ],
  },
];

async function main() {
  // ---- Users --------------------------------------------------------------
  const [adminHash, customerHash] = await Promise.all([
    argon2.hash('Admin!Passw0rd', ARGON_OPTS),
    argon2.hash('Shopper!Passw0rd', ARGON_OPTS),
  ]);

  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { role: Role.ADMIN },
    create: {
      email: 'admin@example.com',
      passwordHash: adminHash,
      name: 'Store Admin',
      role: Role.ADMIN,
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'shopper@example.com' },
    update: {},
    create: {
      email: 'shopper@example.com',
      passwordHash: customerHash,
      name: 'Sam Shopper',
      role: Role.CUSTOMER,
    },
  });

  await prisma.address.deleteMany({ where: { userId: customer.id } });
  await prisma.address.create({
    data: {
      userId: customer.id,
      label: 'Home',
      fullName: 'Sam Shopper',
      line1: '14 Cotton Row',
      city: 'Manchester',
      postalCode: 'M1 2AB',
      country: 'GB',
      isDefault: true,
    },
  });

  // ---- Categories ---------------------------------------------------------
  const categoryBySlug = new Map<string, string>();
  for (const cat of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: cat,
    });
    categoryBySlug.set(cat.slug, row.id);
  }

  // ---- Products, options, variants ---------------------------------------
  for (const seed of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { slug: seed.slug },
      update: {
        title: seed.title,
        description: seed.description,
        brand: seed.brand,
        categoryId: categoryBySlug.get(seed.category) ?? null,
        isActive: true,
      },
      create: {
        slug: seed.slug,
        title: seed.title,
        description: seed.description,
        brand: seed.brand,
        categoryId: categoryBySlug.get(seed.category) ?? null,
      },
    });

    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: placeholder(seed.badge, seed.swatch[0], seed.swatch[1]),
        alt: `${seed.title} product photograph`,
        position: 0,
      },
    });

    // option name -> value -> optionValueId
    const valueIds = new Map<string, Map<string, string>>();

    for (const [index, option] of seed.options.entries()) {
      const optionRow = await prisma.productOption.upsert({
        where: { productId_name: { productId: product.id, name: option.name } },
        update: { position: index },
        create: { productId: product.id, name: option.name, position: index },
      });

      const inner = new Map<string, string>();
      for (const [vIndex, value] of option.values.entries()) {
        const valueRow = await prisma.productOptionValue.upsert({
          where: { optionId_value: { optionId: optionRow.id, value } },
          update: { position: vIndex },
          create: { optionId: optionRow.id, value, position: vIndex },
        });
        inner.set(value, valueRow.id);
      }
      valueIds.set(option.name, inner);
    }

    for (const variant of seed.variants) {
      const row = await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        update: {
          priceCents: variant.priceCents,
          compareAtCents: variant.compareAtCents ?? null,
          stock: variant.stock,
          isActive: true,
          productId: product.id,
        },
        create: {
          productId: product.id,
          sku: variant.sku,
          priceCents: variant.priceCents,
          compareAtCents: variant.compareAtCents ?? null,
          stock: variant.stock,
        },
      });

      // Rebuild the option links rather than diffing them. Cheap at this size,
      // and it guarantees a re-run cannot leave a variant pointing at a value
      // it no longer has.
      await prisma.variantOptionValue.deleteMany({ where: { variantId: row.id } });
      for (const [optionName, value] of Object.entries(variant.options)) {
        const id = valueIds.get(optionName)?.get(value);
        if (!id)
          throw new Error(`Seed error: ${variant.sku} references unknown ${optionName}=${value}`);
        await prisma.variantOptionValue.create({
          data: { variantId: row.id, optionValueId: id },
        });
      }
    }
  }

  const counts = {
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    variants: await prisma.productVariant.count(),
    users: await prisma.user.count(),
  };
  // eslint-disable-next-line no-console
  console.log('Seed complete:', counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
