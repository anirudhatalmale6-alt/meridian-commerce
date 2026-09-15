import { OrderStatus } from '@prisma/client';
import { conflict } from '../../http/errors.js';

/**
 * Order status is a state machine, not a free-text field an admin can set to
 * anything.
 *
 * Without this, a dashboard dropdown will happily move a REFUNDED order back to
 * AWAITING_PAYMENT, or mark a CANCELLED order SHIPPED, and the finance export
 * quietly stops adding up. Every allowed edge is listed here; anything not
 * listed is refused with a 409 that names both states.
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.PAYMENT_RECEIVED, OrderStatus.CANCELLED],
  [OrderStatus.PAYMENT_RECEIVED]: [
    OrderStatus.PROCESSING,
    OrderStatus.REFUNDED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.REFUNDED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
  [OrderStatus.COMPLETED]: [OrderStatus.REFUNDED],
  // Terminal. A cancelled or refunded order is history; a new order is the
  // only way forward, which keeps the audit trail readable.
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    throw conflict(`This order is already ${humanStatus(to)}.`);
  }
  if (!canTransition(from, to)) {
    throw conflict(`Cannot move an order from ${humanStatus(from)} to ${humanStatus(to)}.`, {
      from,
      to,
      allowed: TRANSITIONS[from],
    });
  }
}

/** Statuses a customer may reach on their own order, without an admin. */
export const CUSTOMER_ALLOWED: Partial<Record<OrderStatus, OrderStatus[]>> = {
  // A shopper can abandon an unpaid order. They cannot mark it paid -- that is
  // the entire point of a manual bank transfer flow.
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.CANCELLED],
};

export function humanStatus(status: OrderStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

/** Statuses at which stock has been committed and must be returned on reversal. */
export const STOCK_COMMITTED: OrderStatus[] = [
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAYMENT_RECEIVED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.COMPLETED,
];
