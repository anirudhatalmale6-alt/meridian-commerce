import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { useAuth } from '../hooks/authContext';
import { useCart } from '../hooks/useCart';
import type { BankPayment, Order } from '../lib/types';
import { Button, EmptyState, Eyebrow, Field, Notice, Select, Skeleton } from '../components/ui';

const SHIPPING_FLAT_CENTS = 599;
const FREE_SHIPPING_THRESHOLD_CENTS = 7500;

const COUNTRIES = [
  ['GB', 'United Kingdom'],
  ['IE', 'Ireland'],
  ['US', 'United States'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['NL', 'Netherlands'],
  ['IN', 'India'],
];

export function CheckoutPage() {
  const { user, addresses, isLoading: authLoading } = useAuth();
  const { data: cart, isLoading: cartLoading } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];

  const [form, setForm] = useState({
    fullName: defaultAddress?.fullName ?? user?.name ?? '',
    line1: defaultAddress?.line1 ?? '',
    line2: defaultAddress?.line2 ?? '',
    city: defaultAddress?.city ?? '',
    region: defaultAddress?.region ?? '',
    postalCode: defaultAddress?.postalCode ?? '',
    country: defaultAddress?.country ?? 'GB',
    phone: defaultAddress?.phone ?? '',
  });
  const [note, setNote] = useState('');
  const [saveAddress, setSaveAddress] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const checkout = useMutation({
    mutationFn: () =>
      api.post<{ order: Order; payment: BankPayment }>('/orders/checkout', {
        shipping: {
          fullName: form.fullName,
          line1: form.line1,
          line2: form.line2 || null,
          city: form.city,
          region: form.region || null,
          postalCode: form.postalCode,
          country: form.country,
          phone: form.phone || null,
        },
        customerNote: note || null,
        saveAddress,
      }),
    onSuccess: async (data) => {
      // The server emptied the cart inside the order transaction, so the
      // cached copy is stale the instant this returns.
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/order/${data.order.orderNumber}`, { replace: true });
    },
    onError: (err) => {
      setFieldErrors(err instanceof ApiError ? err.fieldErrors : {});
    },
  });

  if (authLoading || cartLoading) {
    return (
      <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-8 h-72 w-full" />
      </div>
    );
  }

  // Not signed in: a bank-transfer order needs an account to attach the order
  // and the payment reference to. Said plainly, with the return path preserved.
  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center sm:px-8">
        <Eyebrow>Checkout</Eyebrow>
        <h1 className="mt-5 font-display text-4xl font-semibold tracking-[-0.03em] text-ink">
          Sign in to finish
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          Bank transfer orders are tied to an account so you can quote the reference and track the
          order once the payment lands. Your basket is saved and will be here when you get back.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/login" state={{ from: '/checkout' }}>
            <Button size="lg">Sign in</Button>
          </Link>
          <Link to="/register" state={{ from: '/checkout' }}>
            <Button size="lg" tone="quiet">
              Create an account
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20 sm:px-8">
        <EmptyState
          title="Your basket is empty."
          body="There is nothing to check out yet. Have a look at the catalogue and add something first."
          action={{ to: '/', label: 'Browse the shop' }}
        />
      </div>
    );
  }

  // Shown for information only. The server recomputes all of this from the
  // cart -- these figures never decide what is charged.
  const shippingCents =
    cart.subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FLAT_CENTS;
  const totalCents = cart.subtotalCents + shippingCents;

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [key]: e.target.value });

  return (
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
      <div className="border-b border-paper-edge py-10">
        <Eyebrow>Checkout</Eyebrow>
        <h1 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-none tracking-[-0.03em] text-ink">
          Where is it going?
        </h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFieldErrors({});
          checkout.mutate();
        }}
        className="grid gap-12 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16"
        noValidate
      >
        <div className="space-y-8">
          {checkout.isError && (
            <Notice>
              {checkout.error instanceof ApiError
                ? checkout.error.message
                : 'The order could not be placed. Please try again.'}
            </Notice>
          )}

          <section className="space-y-4">
            <h2 className="label-xs">Delivery address</h2>

            <Field
              label="Full name"
              autoComplete="name"
              required
              value={form.fullName}
              onChange={set('fullName')}
              error={fieldErrors['shipping.fullName']}
            />
            <Field
              label="Address line 1"
              autoComplete="address-line1"
              required
              value={form.line1}
              onChange={set('line1')}
              error={fieldErrors['shipping.line1']}
            />
            <Field
              label="Address line 2"
              autoComplete="address-line2"
              value={form.line2}
              onChange={set('line2')}
              error={fieldErrors['shipping.line2']}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="City"
                autoComplete="address-level2"
                required
                value={form.city}
                onChange={set('city')}
                error={fieldErrors['shipping.city']}
              />
              <Field
                label="County / State"
                autoComplete="address-level1"
                value={form.region}
                onChange={set('region')}
                error={fieldErrors['shipping.region']}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Postcode"
                autoComplete="postal-code"
                required
                value={form.postalCode}
                onChange={set('postalCode')}
                error={fieldErrors['shipping.postalCode']}
              />
              <Select label="Country" value={form.country} onChange={set('country')}>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>

            <Field
              label="Phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={set('phone')}
              hint="Only used if the courier needs to reach you."
              error={fieldErrors['shipping.phone']}
            />

            <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={saveAddress}
                onChange={(e) => setSaveAddress(e.target.checked)}
                className="h-4 w-4 accent-rust"
              />
              Save this address to my account
            </label>
          </section>

          <section>
            <label htmlFor="note" className="label-xs mb-1.5 block">
              Note for us (optional)
            </label>
            <textarea
              id="note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Leave with a neighbour, gift wrap, anything we should know."
              className="w-full border border-paper-edge bg-paper px-3 py-2.5 text-sm placeholder:text-ink-faint/60 focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-rust"
            />
          </section>

          <section className="border border-paper-edge bg-paper-deep/40 px-5 py-5">
            <h2 className="label-xs mb-3">Payment — bank transfer</h2>
            <p className="text-sm leading-relaxed text-ink-soft">
              Place the order and we will show you the account details and a unique reference.
              Transfer the exact total quoting that reference; your order moves to{' '}
              <span className="text-ink">payment received</span> as soon as it lands and we confirm
              it. Nothing is charged automatically and no card details are collected.
            </p>
          </section>
        </div>

        {/* ---- Summary ---------------------------------------------------- */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="border border-paper-edge">
            <h2 className="border-b border-paper-edge px-5 py-4 font-display text-lg text-ink">
              Your order
            </h2>

            <ul className="divide-y divide-paper-edge px-5">
              {cart.items.map((item) => (
                <li key={item.id} className="flex gap-3.5 py-4">
                  <img
                    src={item.image ?? ''}
                    alt={item.productTitle}
                    width={56}
                    height={56}
                    className="h-14 w-14 border border-paper-edge object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-ink">{item.productTitle}</p>
                    {item.variantLabel && (
                      <p className="mt-0.5 text-xs text-ink-faint">{item.variantLabel}</p>
                    )}
                    <p className="nums mt-0.5 text-xs text-ink-faint">
                      {formatMoney(item.unitCents)} × {item.quantity}
                    </p>
                  </div>
                  <p className="nums shrink-0 text-sm">{formatMoney(item.lineCents)}</p>
                </li>
              ))}
            </ul>

            <dl className="nums space-y-2.5 border-t border-paper-edge px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Subtotal</dt>
                <dd>{formatMoney(cart.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Shipping</dt>
                <dd>{shippingCents === 0 ? 'Free' : formatMoney(shippingCents)}</dd>
              </div>
              {shippingCents > 0 && (
                <p className="text-xs text-ink-faint">
                  Add {formatMoney(FREE_SHIPPING_THRESHOLD_CENTS - cart.subtotalCents)} for free
                  shipping.
                </p>
              )}
              <div className="flex items-baseline justify-between border-t border-paper-edge pt-3">
                <dt className="label-xs">Total</dt>
                <dd className="font-display text-2xl text-ink">{formatMoney(totalCents)}</dd>
              </div>
            </dl>

            <div className="px-5 pb-5">
              <Button type="submit" size="lg" block loading={checkout.isPending}>
                {checkout.isPending ? 'Placing order' : 'Place order'}
              </Button>
              <p className="mt-2.5 text-center text-xs text-ink-faint">
                Final total is confirmed by the server when the order is created.
              </p>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
