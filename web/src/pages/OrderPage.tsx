import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/money';
import type { BankPayment, Order } from '../lib/types';
import { Button, Eyebrow, Notice, Skeleton, StatusBadge } from '../components/ui';

export function OrderPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const queryClient = useQueryClient();

  const query = useQuery<{ order: Order; payment?: BankPayment }>({
    queryKey: ['orders', orderNumber],
    queryFn: () => api.get(`/orders/${orderNumber}`),
    enabled: Boolean(orderNumber),
  });

  const cancel = useMutation({
    mutationFn: () => api.post<{ order: Order }>(`/orders/${orderNumber}/cancel`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-12 w-72" />
        <Skeleton className="mt-8 h-64 w-full" />
      </div>
    );
  }

  if (query.isError) {
    // A 404 here is also what another customer's order number returns, by
    // design -- so the copy must not imply the order exists.
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-3xl text-ink">
          {missing ? 'We cannot find that order.' : 'Something went wrong.'}
        </h1>
        <p className="mt-3 text-sm text-ink-soft">
          {missing
            ? 'Check the order number, and that you are signed in with the account that placed it.'
            : 'The order could not be loaded. Please try again.'}
        </p>
        <Link
          to="/account/orders"
          className="mt-7 inline-block border border-ink px-5 py-2.5 text-[0.8125rem] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          Your orders
        </Link>
      </div>
    );
  }

  const { order, payment } = query.data!;
  const canCancel = order.status === 'AWAITING_PAYMENT';

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8">
      <div className="rise border-b border-paper-edge py-10">
        <Eyebrow>Order placed</Eyebrow>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h1 className="nums font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-none tracking-[-0.03em] text-ink">
            {order.orderNumber}
          </h1>
          <StatusBadge status={order.status} />
        </div>
        <p className="mt-3 text-sm text-ink-soft">{formatDateTime(order.createdAt)}</p>
      </div>

      {/* ---- Payment instructions ---------------------------------------- */}
      {payment && (
        <section
          className="rise mt-8 border-2 border-rust/30 bg-rust-wash/60 px-6 py-6"
          style={{ animationDelay: '80ms' }}
        >
          <h2 className="font-display text-xl text-ink">Pay by bank transfer</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
            Transfer the exact total below and quote the reference. We confirm it by hand, so your
            order moves on as soon as it lands.
          </p>

          <dl className="nums mt-5 grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
            <div>
              <dt className="label-xs">Amount</dt>
              <dd className="mt-0.5 font-display text-2xl text-ink">
                {formatMoney(payment.amountCents, payment.currency)}
              </dd>
            </div>
            <div>
              <dt className="label-xs">Reference — quote this</dt>
              <dd className="mt-0.5 font-display text-2xl tracking-tight text-rust">
                {payment.reference}
              </dd>
            </div>
            <div>
              <dt className="label-xs">Account name</dt>
              <dd className="mt-0.5 text-sm text-ink">{payment.bank.accountName}</dd>
            </div>
            {payment.bank.accountNumber && (
              <div>
                <dt className="label-xs">Account number</dt>
                <dd className="mt-0.5 text-sm text-ink">{payment.bank.accountNumber}</dd>
              </div>
            )}
            {payment.bank.sortCode && (
              <div>
                <dt className="label-xs">Sort code</dt>
                <dd className="mt-0.5 text-sm text-ink">{payment.bank.sortCode}</dd>
              </div>
            )}
            {payment.bank.iban && (
              <div>
                <dt className="label-xs">IBAN</dt>
                <dd className="mt-0.5 text-sm text-ink">{payment.bank.iban}</dd>
              </div>
            )}
            {payment.bank.swift && (
              <div>
                <dt className="label-xs">SWIFT / BIC</dt>
                <dd className="mt-0.5 text-sm text-ink">{payment.bank.swift}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* ---- Lines ------------------------------------------------------- */}
      <section className="rise mt-10" style={{ animationDelay: '140ms' }}>
        <h2 className="label-xs mb-3">Items</h2>
        <ul className="divide-y divide-paper-edge border-y border-paper-edge">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-baseline gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{item.productTitle}</p>
                {item.variantLabel && (
                  <p className="mt-0.5 text-xs text-ink-faint">{item.variantLabel}</p>
                )}
                <p className="nums mt-0.5 text-xs text-ink-faint">{item.sku}</p>
              </div>
              <p className="nums shrink-0 text-sm text-ink-soft">
                {formatMoney(item.unitCents)} × {item.quantity}
              </p>
              <p className="nums w-20 shrink-0 text-right text-sm">{formatMoney(item.lineCents)}</p>
            </li>
          ))}
        </ul>

        <dl className="nums mt-4 ml-auto max-w-xs space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Subtotal</dt>
            <dd>{formatMoney(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Shipping</dt>
            <dd>{order.shippingCents === 0 ? 'Free' : formatMoney(order.shippingCents)}</dd>
          </div>
          {order.taxCents > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-soft">Tax</dt>
              <dd>{formatMoney(order.taxCents)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-paper-edge pt-2.5">
            <dt className="label-xs">Total</dt>
            <dd className="font-display text-xl text-ink">
              {formatMoney(order.totalCents, order.currency)}
            </dd>
          </div>
        </dl>
      </section>

      {/* ---- Address + history ------------------------------------------- */}
      <div className="rise mt-10 grid gap-8 sm:grid-cols-2" style={{ animationDelay: '200ms' }}>
        <section>
          <h2 className="label-xs mb-3">Delivering to</h2>
          <address className="text-sm not-italic leading-relaxed text-ink-soft">
            {order.shipFullName}
            <br />
            {order.shipLine1}
            <br />
            {order.shipLine2 && (
              <>
                {order.shipLine2}
                <br />
              </>
            )}
            {order.shipCity}
            {order.shipRegion ? `, ${order.shipRegion}` : ''}
            <br />
            <span className="nums">{order.shipPostalCode}</span>
            <br />
            {order.shipCountry}
          </address>
          {order.customerNote && (
            <p className="mt-4 border-l-2 border-paper-edge pl-3 text-sm italic text-ink-soft">
              “{order.customerNote}”
            </p>
          )}
        </section>

        <section>
          <h2 className="label-xs mb-3">History</h2>
          <ol className="space-y-3">
            {order.events.map((event) => (
              <li key={event.id} className="border-l-2 border-paper-edge pl-3">
                <p className="text-sm text-ink">{event.to.replace(/_/g, ' ').toLowerCase()}</p>
                <p className="nums text-xs text-ink-faint">{formatDateTime(event.createdAt)}</p>
                {event.note && <p className="mt-0.5 text-xs text-ink-soft">{event.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-4 border-t border-paper-edge pt-8">
        <Link to="/">
          <Button tone="quiet">Keep shopping</Button>
        </Link>
        <Link to="/account/orders">
          <Button tone="quiet">All your orders</Button>
        </Link>

        {canCancel && (
          <Button
            tone="danger"
            className="ml-auto"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel this order
          </Button>
        )}
      </div>

      {cancel.isError && (
        <div className="mt-4">
          <Notice>
            {cancel.error instanceof ApiError
              ? cancel.error.message
              : 'The order could not be cancelled.'}
          </Notice>
        </div>
      )}
    </div>
  );
}
