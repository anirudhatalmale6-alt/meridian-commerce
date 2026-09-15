import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/money';
import { useAuth } from '../hooks/authContext';
import type { AdminStats, Order, OrderStatus } from '../lib/types';
import { Button, Eyebrow, Notice, Skeleton, StatusBadge } from '../components/ui';

const FILTERS: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'AWAITING_PAYMENT', label: 'Awaiting payment' },
  { value: 'PAYMENT_RECEIVED', label: 'Paid' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SHIPPED', label: 'Shipped' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/**
 * The next statuses an admin may move an order to, mirroring the server's state
 * machine. The server is still the authority -- this only keeps the UI from
 * offering a button that is guaranteed to come back 409.
 */
const NEXT_STATUS: Partial<Record<OrderStatus, { to: OrderStatus; label: string }[]>> = {
  AWAITING_PAYMENT: [
    { to: 'PAYMENT_RECEIVED', label: 'Mark paid' },
    { to: 'CANCELLED', label: 'Cancel' },
  ],
  PAYMENT_RECEIVED: [
    { to: 'PROCESSING', label: 'Start picking' },
    { to: 'REFUNDED', label: 'Refund' },
  ],
  PROCESSING: [
    { to: 'SHIPPED', label: 'Mark shipped' },
    { to: 'REFUNDED', label: 'Refund' },
  ],
  SHIPPED: [{ to: 'COMPLETED', label: 'Complete' }],
  COMPLETED: [{ to: 'REFUNDED', label: 'Refund' }],
};

export function AdminPage() {
  const { user, isAdmin, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<OrderStatus | ''>('');
  const [search, setSearch] = useState('');

  const stats = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get('/admin/stats'),
    enabled: isAdmin,
  });

  const orders = useQuery<{ orders: Order[]; total: number }>({
    queryKey: ['admin', 'orders', filter, search],
    queryFn: () => {
      const sp = new URLSearchParams({ perPage: '25' });
      if (filter) sp.set('status', filter);
      if (search) sp.set('q', search);
      return api.get(`/admin/orders?${sp.toString()}`);
    },
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  const transition = useMutation({
    mutationFn: (vars: { orderNumber: string; status: OrderStatus }) =>
      api.post<{ order: Order }>(`/admin/orders/${vars.orderNumber}/status`, {
        status: vars.status,
      }),
    onSuccess: async () => {
      // Stats AND the list both move when an order changes status -- revenue is
      // derived from paid orders, so refetching only the list would leave the
      // dashboard figure stale and wrong.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] }),
      ]);
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-8 h-32 w-full" />
      </div>
    );
  }

  // The client-side check is a courtesy, not the guard. Every /api/admin route
  // is enforced server-side and re-reads the role from the database, so a user
  // who forces this route into view still gets 401/403 on every request.
  if (!user || !isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center sm:px-8">
        <Eyebrow>Restricted</Eyebrow>
        <h1 className="mt-5 font-display text-4xl font-semibold tracking-[-0.03em] text-ink">
          Staff only
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          This dashboard needs an admin account. The API refuses these endpoints regardless of what
          the browser shows.
        </p>
        <Link to={user ? '/' : '/login'} state={{ from: '/admin' }} className="mt-8 inline-block">
          <Button size="lg">{user ? 'Back to the shop' : 'Sign in'}</Button>
        </Link>
      </div>
    );
  }

  const tiles = [
    {
      label: 'Paid revenue',
      value: stats.data ? formatMoney(stats.data.paidRevenueCents) : '—',
    },
    { label: 'Orders', value: stats.data?.orderCount ?? '—' },
    {
      label: 'Awaiting payment',
      value: stats.data?.awaitingPayment ?? '—',
      accent: true,
    },
    { label: 'Customers', value: stats.data?.customers ?? '—' },
    { label: 'Products live', value: stats.data?.productCount ?? '—' },
    {
      label: 'Low stock',
      value: stats.data?.lowStockVariants ?? '—',
      accent: true,
    },
  ];

  return (
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
      <div className="border-b border-paper-edge py-10">
        <Eyebrow>Dashboard</Eyebrow>
        <h1 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-none tracking-[-0.03em] text-ink">
          Order management
        </h1>
        <p className="mt-3 text-sm text-ink-soft">
          Bank transfers are confirmed by hand. Marking an order paid returns stock on a reversal
          and writes an audit event with your user id.
        </p>
      </div>

      {/* ---- Stat tiles -------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-px border border-paper-edge bg-paper-edge sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile, i) => (
          <div
            key={tile.label}
            className="rise bg-paper px-4 py-5"
            style={{ animationDelay: `${i * 45}ms` }}
          >
            <p className="label-xs">{tile.label}</p>
            <p
              className={`nums mt-1.5 font-display text-2xl ${
                tile.accent && Number(tile.value) > 0 ? 'text-rust' : 'text-ink'
              }`}
            >
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      {/* ---- Filters ----------------------------------------------------- */}
      <div className="mt-10 flex flex-wrap items-end gap-4">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              onClick={() => setFilter(f.value)}
              className={`border px-3 py-1.5 text-xs uppercase tracking-[0.08em] transition-colors ${
                filter === f.value
                  ? 'border-ink bg-ink text-paper'
                  : 'border-paper-edge text-ink-soft hover:border-ink hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <label htmlFor="admin-search" className="label-xs mb-1.5 block">
            Find
          </label>
          <input
            id="admin-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order no., reference, name, email"
            className="w-64 border border-paper-edge bg-paper px-3 py-2 text-sm placeholder:text-ink-faint/60 focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-rust"
          />
        </div>
      </div>

      {transition.isError && (
        <div className="mt-6">
          <Notice>
            {transition.error instanceof ApiError
              ? transition.error.message
              : 'That status change was refused.'}
          </Notice>
        </div>
      )}

      {/* ---- Orders ------------------------------------------------------ */}
      <div className="mt-6 pb-16">
        {orders.isLoading && <Skeleton className="h-64 w-full" />}

        {orders.data && orders.data.orders.length === 0 && (
          <p className="border border-dashed border-paper-edge px-6 py-14 text-center text-sm text-ink-soft">
            No orders match that filter.
          </p>
        )}

        {orders.data && orders.data.orders.length > 0 && (
          <>
            <p className="nums mb-3 text-xs text-ink-faint">
              {orders.data.total} order{orders.data.total === 1 ? '' : 's'}
            </p>

            {/* The table scrolls inside its own container, so a narrow screen
                never gives the whole page a horizontal scrollbar. */}
            <div className="overflow-x-auto border border-paper-edge">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-paper-edge bg-paper-deep/50">
                    <th className="label-xs px-4 py-3">Order</th>
                    <th className="label-xs px-4 py-3">Customer</th>
                    <th className="label-xs px-4 py-3">Reference</th>
                    <th className="label-xs px-4 py-3">Status</th>
                    <th className="label-xs px-4 py-3 text-right">Total</th>
                    <th className="label-xs px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-edge">
                  {orders.data.orders.map((order) => (
                    <tr
                      key={order.id}
                      className="align-top transition-colors hover:bg-paper-deep/40"
                    >
                      <td className="px-4 py-4">
                        <Link
                          to={`/order/${order.orderNumber}`}
                          className="nums link-slide font-display text-[0.9375rem] text-ink"
                        >
                          {order.orderNumber}
                        </Link>
                        <p className="nums mt-0.5 text-xs text-ink-faint">
                          {formatDate(order.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-ink">{order.shipFullName}</p>
                        <p className="mt-0.5 text-xs text-ink-faint">{order.user?.email}</p>
                      </td>
                      <td className="nums px-4 py-4 text-xs text-ink-soft">
                        {order.paymentReference}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="nums px-4 py-4 text-right">
                        {formatMoney(order.totalCents, order.currency)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {(NEXT_STATUS[order.status] ?? []).map((action) => (
                            <Button
                              key={action.to}
                              size="sm"
                              tone={
                                action.to === 'PAYMENT_RECEIVED'
                                  ? 'primary'
                                  : action.to === 'CANCELLED' || action.to === 'REFUNDED'
                                    ? 'danger'
                                    : 'quiet'
                              }
                              loading={
                                transition.isPending &&
                                transition.variables?.orderNumber === order.orderNumber &&
                                transition.variables?.status === action.to
                              }
                              onClick={() =>
                                transition.mutate({
                                  orderNumber: order.orderNumber,
                                  status: action.to,
                                })
                              }
                            >
                              {action.label}
                            </Button>
                          ))}
                          {(NEXT_STATUS[order.status] ?? []).length === 0 && (
                            <span className="text-xs text-ink-faint">Terminal</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
