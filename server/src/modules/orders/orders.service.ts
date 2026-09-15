import crypto from 'node:crypto';
import { OrderStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { conflict, notFound, unprocessable } from '../../http/errors.js';
import { assertTransition, STOCK_COMMITTED } from './order.status.js';
import { env } from '../../env.js';

export const SHIPPING_FLAT_CENTS = 599;
export const FREE_SHIPPING_THRESHOLD_CENTS = 7500;
export const TAX_RATE_BP = 0; // basis points; no tax engine wired up yet.

export const orderInclude = {
  items: true,
  events: { orderBy: { createdAt: 'asc' } },
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.OrderInclude;

export interface ShippingInput {
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
}

/**
 * Turn the caller's cart into an order.
 *
 * Everything here happens inside ONE transaction with stock decremented under a
 * conditional update. The reason is the classic oversell: two shoppers hold the
 * last unit, both read stock=1, both pass the check, both write stock=0, and the
 * warehouse has one item and two paid orders. Reading-then-writing cannot fix
 * that no matter how carefully it is written -- the check has to be part of the
 * write, which is what `updateMany({ where: { stock: { gte: qty } } })` does.
 */
export async function createOrderFromCart(
  userId: string,
  shipping: ShippingInput,
  customerNote?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: true,
                optionValues: { include: { optionValue: { include: { option: true } } } },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw unprocessable('Your cart is empty.');
    }

    const lines: Prisma.OrderItemCreateWithoutOrderInput[] = [];

    for (const item of cart.items) {
      const v = item.variant;

      if (!v.isActive || !v.product.isActive) {
        throw unprocessable(
          `${v.product.title} is no longer available. Please remove it from your cart.`,
        );
      }

      // The conditional decrement. `count === 0` means somebody else took the
      // stock between the cart page and this click.
      const claimed = await tx.productVariant.updateMany({
        where: { id: v.id, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });

      if (claimed.count === 0) {
        const fresh = await tx.productVariant.findUnique({
          where: { id: v.id },
          select: { stock: true },
        });
        throw conflict(
          fresh && fresh.stock > 0
            ? `Only ${fresh.stock} of ${v.product.title} left -- please lower the quantity.`
            : `${v.product.title} sold out while you were checking out.`,
          { variantId: v.id, available: fresh?.stock ?? 0 },
        );
      }

      const variantLabel = v.optionValues
        .slice()
        .sort((a, b) => a.optionValue.option.position - b.optionValue.option.position)
        .map((ov) => `${ov.optionValue.option.name}: ${ov.optionValue.value}`)
        .join(' / ');

      lines.push({
        variant: { connect: { id: v.id } },
        productTitle: v.product.title,
        variantLabel,
        sku: v.sku,
        unitCents: v.priceCents,
        quantity: item.quantity,
        lineCents: v.priceCents * item.quantity,
      });
    }

    const subtotalCents = lines.reduce((sum, l) => sum + l.lineCents, 0);
    const shippingCents = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FLAT_CENTS;
    // Integer arithmetic throughout, rounded once at the end. Tax computed on
    // the subtotal in cents avoids the float drift that turns 19.99 into 19.98.
    const taxCents = Math.round((subtotalCents * TAX_RATE_BP) / 10_000);
    const totalCents = subtotalCents + shippingCents + taxCents;

    const order = await tx.order.create({
      data: {
        orderNumber: await nextOrderNumber(tx),
        paymentReference: paymentReference(),
        userId,
        status: OrderStatus.AWAITING_PAYMENT,
        subtotalCents,
        shippingCents,
        taxCents,
        totalCents,
        shipFullName: shipping.fullName,
        shipLine1: shipping.line1,
        shipLine2: shipping.line2 ?? null,
        shipCity: shipping.city,
        shipRegion: shipping.region ?? null,
        shipPostalCode: shipping.postalCode,
        shipCountry: shipping.country.toUpperCase(),
        shipPhone: shipping.phone ?? null,
        customerNote: customerNote ?? null,
        items: { create: lines },
        events: {
          create: { to: OrderStatus.AWAITING_PAYMENT, actorId: userId, note: 'Order placed.' },
        },
      },
      include: orderInclude,
    });

    // The cart is emptied only now, inside the same transaction. Clearing it
    // first would lose the basket if any line failed its stock check.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    return order;
  });
}

export async function changeStatus(
  orderId: string,
  to: OrderStatus,
  actorId: string,
  note?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw notFound('Order not found.');

    assertTransition(order.status, to);

    // Reversal returns stock. Without this, cancelling orders slowly drains
    // sellable inventory until someone notices the shop says sold out with a
    // full warehouse.
    const reversing = to === OrderStatus.CANCELLED || to === OrderStatus.REFUNDED;
    if (reversing && STOCK_COMMITTED.includes(order.status)) {
      for (const line of order.items) {
        if (!line.variantId) continue;
        await tx.productVariant.update({
          where: { id: line.variantId },
          data: { stock: { increment: line.quantity } },
        });
      }
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        ...(to === OrderStatus.PAYMENT_RECEIVED && !order.paidAt ? { paidAt: new Date() } : {}),
        events: { create: { from: order.status, to, actorId, note: note ?? null } },
      },
      include: orderInclude,
    });

    return updated;
  });
}

export function bankDetails() {
  return {
    accountName: env.BANK_ACCOUNT_NAME,
    accountNumber: env.BANK_ACCOUNT_NUMBER,
    sortCode: env.BANK_SORT_CODE,
    iban: env.BANK_IBAN,
    swift: env.BANK_SWIFT,
  };
}

/**
 * Sequential, human-quotable order number (SHOP-000001).
 *
 * Derived from a count inside the caller's transaction rather than from a
 * separate query, so two simultaneous checkouts cannot both read the same count.
 * If the unique index still fires under real load, the retry loop in the route
 * handles it -- a duplicate order number must never surface to a customer.
 */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.order.count();
  return `SHOP-${String(count + 1).padStart(6, '0')}`;
}

/** Short, unambiguous reference the shopper types into their banking app. */
function paymentReference(): string {
  // Base32-ish alphabet with I, O, 0 and 1 removed: a reference that gets read
  // aloud or retyped must not turn a 0 into an O in transit.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `REF-${out}`;
}
