import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/money';
import { useAuth } from '../hooks/authContext';
import type { Order } from '../lib/types';
import { Button, EmptyState, Eyebrow, Skeleton, StatusBadge } from '../components/ui';

interface OrdersResponse {
  orders: Order[];
  total: number;
}

export function AccountOrdersPage() {
  const { user, isLoading: authLoading } = useAuth();

  const query = useQuery<OrdersResponse>({
    queryKey: ['orders', 'mine'],
    queryFn: () => api.get('/orders?perPage=25'),
    // Only ask once we know somebody is signed in, otherwise every anonymous
    // visit fires a request that is guaranteed to 401.
    enabled: Boolean(user),
  });

  if (authLoading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="mt-8 h-40 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center sm:px-8">
        <Eyebrow>Your orders</Eyebrow>
        <h1 className="mt-5 font-display text-4xl font-semibold tracking-[-0.03em] text-ink">
          Sign in to see your orders
        </h1>
        <Link to="/login" state={{ from: '/account/orders' }} className="mt-8 inline-block">
          <Button size="lg">Sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-5 sm:px-8">
      <div className="border-b border-paper-edge py-10">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-none tracking-[-0.03em] text-ink">
          Your orders
        </h1>
        <p className="mt-3 text-sm text-ink-soft">
          Signed in as {user.name} · {user.email}
        </p>
      </div>

      <div className="py-10">
        {query.isLoading && <Skeleton className="h-40 w-full" />}

        {query.data && query.data.orders.length === 0 && (
          <EmptyState
            title="No orders yet."
            body="When you place an order it will appear here with its payment reference and status."
            action={{ to: '/', label: 'Browse the shop' }}
          />
        )}

        <ul className="space-y-4">
          {query.data?.orders.map((order, i) => (
            <li
              key={order.id}
              className="rise border border-paper-edge transition-colors hover:border-ink"
              style={{ animationDelay: `${Math.min(i * 60, 360)}ms` }}
            >
              <Link to={`/order/${order.orderNumber}`} className="block px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="nums font-display text-lg text-ink">{order.orderNumber}</p>
                    <p className="nums mt-0.5 text-xs text-ink-faint">
                      {formatDate(order.createdAt)} · {order.items.length}{' '}
                      {order.items.length === 1 ? 'item' : 'items'}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <StatusBadge status={order.status} />
                    <p className="nums font-display text-xl text-ink">
                      {formatMoney(order.totalCents, order.currency)}
                    </p>
                  </div>
                </div>

                <p className="mt-3 truncate text-sm text-ink-soft">
                  {order.items.map((it) => `${it.quantity}× ${it.productTitle}`).join(', ')}
                </p>

                {order.status === 'AWAITING_PAYMENT' && (
                  <p className="nums mt-2.5 text-xs text-rust">
                    Awaiting your transfer — reference {order.paymentReference}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
