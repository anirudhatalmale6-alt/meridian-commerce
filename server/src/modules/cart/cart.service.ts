import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { badRequest, notFound, unprocessable } from '../../http/errors.js';

export const MAX_QTY_PER_LINE = 99;

const cartInclude = {
  items: {
    orderBy: { addedAt: 'asc' },
    include: {
      variant: {
        include: {
          product: { include: { images: { orderBy: { position: 'asc' }, take: 1 } } },
          optionValues: { include: { optionValue: { include: { option: true } } } },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

/** Identity of whoever is shopping: a signed-in user, or an anonymous session. */
export type CartOwner = { userId: string } | { sessionId: string };

async function findOrCreateCart(owner: CartOwner): Promise<CartWithItems> {
  const where = 'userId' in owner ? { userId: owner.userId } : { sessionId: owner.sessionId };

  const existing = await prisma.cart.findUnique({ where, include: cartInclude });
  if (existing) return existing;

  try {
    return await prisma.cart.create({ data: where, include: cartInclude });
  } catch (err) {
    // Two parallel requests from the same shopper (very normal: the SPA fires
    // GET /cart and POST /cart/items at once on a fresh visit) both miss the
    // findUnique and both try to insert. One wins, one hits the unique index.
    // The loser must read the winner's row, not 500 at the customer.
    if (isUniqueViolation(err)) {
      const raced = await prisma.cart.findUnique({ where, include: cartInclude });
      if (raced) return raced;
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

export async function getCart(owner: CartOwner) {
  const cart = await findOrCreateCart(owner);
  return serialiseCart(cart);
}

export async function addItem(owner: CartOwner, variantId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw badRequest('Quantity must be a whole number of at least 1.');
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });
  if (!variant || !variant.isActive || !variant.product.isActive) {
    throw notFound('That item is no longer available.');
  }

  const cart = await findOrCreateCart(owner);
  const existingLine = cart.items.find((i) => i.variantId === variantId);
  const desired = (existingLine?.quantity ?? 0) + quantity;

  // Stock is checked against the TOTAL the line would reach, not against the
  // increment. Adding 1 to a line of 5 when only 5 exist has to fail.
  assertStock(variant.stock, desired, variant.sku);

  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    create: { cartId: cart.id, variantId, quantity: desired },
    update: { quantity: desired },
  });

  await touchCart(cart.id);
  return getCart(owner);
}

export async function setItemQuantity(owner: CartOwner, variantId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw badRequest('Quantity must be a whole number of 0 or more.');
  }

  const cart = await findOrCreateCart(owner);
  const line = cart.items.find((i) => i.variantId === variantId);
  if (!line) throw notFound('That item is not in your cart.');

  if (quantity === 0) {
    await prisma.cartItem.delete({ where: { id: line.id } });
    await touchCart(cart.id);
    return getCart(owner);
  }

  const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
  if (!variant) throw notFound('That item is no longer available.');
  assertStock(variant.stock, quantity, variant.sku);

  await prisma.cartItem.update({ where: { id: line.id }, data: { quantity } });
  await touchCart(cart.id);
  return getCart(owner);
}

export async function removeItem(owner: CartOwner, variantId: string) {
  const cart = await findOrCreateCart(owner);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
  await touchCart(cart.id);
  return getCart(owner);
}

export async function clearCart(owner: CartOwner) {
  const cart = await findOrCreateCart(owner);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await touchCart(cart.id);
  return getCart(owner);
}

/**
 * Merge an anonymous cart into a user's cart at sign-in.
 *
 * This is the function that quietly loses customers' baskets in most
 * implementations, so it is worth being explicit about the rules:
 *
 *  1. Quantities are SUMMED per variant, not overwritten. If the shopper had 2
 *     of a mug as a guest and 1 already saved to their account, they get 3. An
 *     `upsert` with `update: { quantity }` would silently discard one of them.
 *  2. The sum is CLAMPED to available stock rather than rejected. Sign-in must
 *     never fail because a basket got optimistic -- the customer is trying to
 *     log in, not to check out, and stock is re-validated at checkout anyway.
 *  3. If the user has no cart yet, the guest cart is REASSIGNED by id instead
 *     of copied. Fewer writes and no window where the items exist twice.
 *  4. The whole thing runs in one transaction, so a crash halfway cannot leave
 *     the items deleted from the guest cart but not yet added to the user's.
 *  5. The guest row is deleted at the end, so a stale cookie cannot resurrect
 *     an already-merged basket on the next visit.
 *  6. A line whose variant or product went inactive while the guest was
 *     browsing is DROPPED, not carried in. Both merge paths apply this --
 *     see the note on the reassignment branch.
 */
export async function mergeGuestCartIntoUser(sessionId: string, userId: string): Promise<void> {
  if (!sessionId) return;

  await prisma.$transaction(async (tx) => {
    const guestCart = await tx.cart.findUnique({
      where: { sessionId },
      include: { items: true },
    });
    // Nothing to merge. Not an error -- most sign-ins look like this.
    if (!guestCart) return;

    const userCart = await tx.cart.findUnique({
      where: { userId },
      include: { items: true },
    });

    if (!userCart) {
      if (guestCart.items.length === 0) {
        await tx.cart.delete({ where: { id: guestCart.id } });
        return;
      }

      // Rule 3: hand the existing row to the user rather than copying it.
      //
      // The reassignment still has to honour rule 6 -- an earlier version of
      // this took the fast path and skipped validation entirely, so a variant
      // deactivated while the shopper browsed was carried into their account as
      // an unbuyable line that then blocked checkout. Caught by
      // cart.test.ts: "drops a line whose variant was deactivated".
      await dropUnbuyableItems(
        tx,
        guestCart.id,
        guestCart.items.map((i) => i.variantId),
      );

      const remaining = await tx.cartItem.count({ where: { cartId: guestCart.id } });
      if (remaining === 0) {
        await tx.cart.delete({ where: { id: guestCart.id } });
        return;
      }

      await tx.cart.update({
        where: { id: guestCart.id },
        data: { userId, sessionId: null },
      });
      return;
    }

    if (guestCart.items.length === 0) {
      await tx.cart.delete({ where: { id: guestCart.id } });
      return;
    }

    const stockByVariant = new Map(
      (
        await tx.productVariant.findMany({
          where: { id: { in: guestCart.items.map((i) => i.variantId) } },
          // The product's own flag is selected too: deactivating a product
          // must take its variants out of circulation even when the variant
          // rows are still marked active.
          select: {
            id: true,
            stock: true,
            isActive: true,
            product: { select: { isActive: true } },
          },
        })
      ).map((v) => [v.id, v]),
    );

    for (const guestItem of guestCart.items) {
      const variant = stockByVariant.get(guestItem.variantId);
      // Rule 6: anything deactivated while the guest was browsing is dropped
      // rather than carried into the account as an unbuyable line.
      if (!variant || !variant.isActive || !variant.product.isActive) continue;

      const mine = userCart.items.find((i) => i.variantId === guestItem.variantId);
      const summed = (mine?.quantity ?? 0) + guestItem.quantity; // Rule 1
      const clamped = Math.max(1, Math.min(summed, variant.stock, MAX_QTY_PER_LINE)); // Rule 2

      if (variant.stock <= 0) continue;

      if (mine) {
        await tx.cartItem.update({ where: { id: mine.id }, data: { quantity: clamped } });
      } else {
        await tx.cartItem.create({
          data: { cartId: userCart.id, variantId: guestItem.variantId, quantity: clamped },
        });
      }
    }

    // Rule 5. Items cascade with the row.
    await tx.cart.delete({ where: { id: guestCart.id } });
    await tx.cart.update({ where: { id: userCart.id }, data: { updatedAt: new Date() } });
  });
}

/**
 * Delete cart lines pointing at a variant, or a product, that is no longer
 * sellable. Shared by both merge paths so they cannot drift apart.
 */
async function dropUnbuyableItems(
  tx: Prisma.TransactionClient,
  cartId: string,
  variantIds: string[],
): Promise<void> {
  if (variantIds.length === 0) return;

  const sellable = await tx.productVariant.findMany({
    where: {
      id: { in: variantIds },
      isActive: true,
      // The product matters too: deactivating a whole product must take its
      // variants out of circulation even though their own flag is untouched.
      product: { isActive: true },
    },
    select: { id: true },
  });

  const keep = new Set(sellable.map((v) => v.id));
  const drop = variantIds.filter((id) => !keep.has(id));
  if (drop.length === 0) return;

  await tx.cartItem.deleteMany({ where: { cartId, variantId: { in: drop } } });
}

function assertStock(stock: number, desired: number, sku: string): void {
  if (stock <= 0) throw unprocessable(`${sku} is out of stock.`);
  if (desired > stock) {
    throw unprocessable(`Only ${stock} of ${sku} left.`, { available: stock });
  }
  if (desired > MAX_QTY_PER_LINE) {
    throw unprocessable(`You can order at most ${MAX_QTY_PER_LINE} of one item.`);
  }
}

async function touchCart(cartId: string): Promise<void> {
  await prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
}

export function serialiseCart(cart: CartWithItems) {
  const items = cart.items.map((item) => {
    const label = item.variant.optionValues
      .slice()
      .sort((a, b) => a.optionValue.option.position - b.optionValue.option.position)
      .map((ov) => `${ov.optionValue.option.name}: ${ov.optionValue.value}`)
      .join(' / ');

    return {
      id: item.id,
      variantId: item.variantId,
      productId: item.variant.productId,
      productSlug: item.variant.product.slug,
      productTitle: item.variant.product.title,
      variantLabel: label,
      sku: item.variant.sku,
      unitCents: item.variant.priceCents,
      quantity: item.quantity,
      lineCents: item.variant.priceCents * item.quantity,
      stock: item.variant.stock,
      image: item.variant.product.images[0]?.url ?? null,
    };
  });

  // Totals are derived from the lines on every read, never stored on the cart.
  // A stored subtotal drifts the moment a price changes or a line is edited,
  // and then the number on the cart page disagrees with the number at checkout.
  const subtotalCents = items.reduce((sum, i) => sum + i.lineCents, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return {
    id: cart.id,
    items,
    itemCount,
    subtotalCents,
    currency: 'USD',
    updatedAt: cart.updatedAt,
  };
}
