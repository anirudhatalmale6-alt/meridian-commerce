import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useCart, useCartMutations } from '../hooks/useCart';
import { formatMoney } from '../lib/money';
import { ApiError } from '../lib/api';
import { Button, Notice, Spinner } from './ui';

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: cart, isLoading } = useCart();
  const { setQuantity, remove } = useCartMutations();
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the body does not scroll behind the panel. Both are
  // things people try immediately and notice the absence of.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const mutationError = [setQuantity.error, remove.error].find(Boolean);
  const busy = setQuantity.isPending || remove.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Shopping basket"
    >
      <button
        className="fade-in absolute inset-0 bg-ink/45"
        onClick={onClose}
        aria-label="Close basket"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="drawer-in relative flex h-full w-full max-w-md flex-col border-l border-paper-edge bg-paper shadow-[-24px_0_48px_-24px_rgba(28,24,21,0.28)] focus:outline-none"
      >
        <header className="flex items-center justify-between border-b border-paper-edge px-6 py-5">
          <div>
            <h2 className="font-display text-xl text-ink">Your basket</h2>
            <p className="nums mt-0.5 text-xs text-ink-faint">
              {cart ? `${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}` : '—'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="border border-paper-edge px-3 py-1.5 text-xs uppercase tracking-[0.1em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading && (
            <p className="flex items-center gap-2 text-sm text-ink-faint">
              <Spinner /> Loading your basket…
            </p>
          )}

          {mutationError && (
            <div className="mb-4">
              <Notice>
                {mutationError instanceof ApiError
                  ? mutationError.message
                  : 'That change could not be applied.'}
              </Notice>
            </div>
          )}

          {cart && cart.items.length === 0 && (
            <div className="py-12 text-center">
              <p className="font-display text-lg text-ink">Nothing here yet.</p>
              <p className="mt-2 text-sm text-ink-soft">
                Your basket is saved to your account, so it will be waiting next time.
              </p>
            </div>
          )}

          <ul className="divide-y divide-paper-edge">
            {cart?.items.map((item) => (
              <li key={item.id} className="flex gap-4 py-4">
                <Link to={`/product/${item.productSlug}`} onClick={onClose} className="shrink-0">
                  <img
                    src={item.image ?? ''}
                    alt={item.productTitle}
                    width={80}
                    height={80}
                    className="h-20 w-20 border border-paper-edge object-cover"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    to={`/product/${item.productSlug}`}
                    onClick={onClose}
                    className="link-slide font-display text-[0.9375rem] leading-snug text-ink"
                  >
                    {item.productTitle}
                  </Link>
                  {item.variantLabel && (
                    <p className="mt-0.5 text-xs text-ink-faint">{item.variantLabel}</p>
                  )}

                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex items-center border border-paper-edge">
                      <button
                        onClick={() =>
                          setQuantity.mutate({
                            variantId: item.variantId,
                            quantity: item.quantity - 1,
                          })
                        }
                        disabled={busy}
                        aria-label={`Decrease ${item.productTitle}`}
                        className="px-2.5 py-1 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="nums min-w-8 text-center text-sm">{item.quantity}</span>
                      <button
                        onClick={() =>
                          setQuantity.mutate({
                            variantId: item.variantId,
                            quantity: item.quantity + 1,
                          })
                        }
                        // Capped at what the warehouse actually has, so the
                        // stepper cannot ask for a quantity the API will refuse.
                        disabled={busy || item.quantity >= item.stock}
                        aria-label={`Increase ${item.productTitle}`}
                        className="px-2.5 py-1 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => remove.mutate(item.variantId)}
                      disabled={busy}
                      className="link-slide text-xs text-ink-faint transition-colors hover:text-rust disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>

                  {item.quantity >= item.stock && (
                    <p className="nums mt-1.5 text-xs text-rust">Only {item.stock} in stock</p>
                  )}
                </div>

                <div className="nums shrink-0 text-right text-sm">
                  {formatMoney(item.lineCents)}
                  {item.quantity > 1 && (
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {formatMoney(item.unitCents)} ea
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {cart && cart.items.length > 0 && (
          <footer className="border-t border-paper-edge px-6 py-5">
            <div className="nums flex items-baseline justify-between">
              <span className="label-xs">Subtotal</span>
              <span className="font-display text-2xl text-ink">
                {formatMoney(cart.subtotalCents, cart.currency)}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              Shipping calculated at checkout. Free over {formatMoney(7500)}.
            </p>
            <Link to="/checkout" onClick={onClose} className="mt-4 block">
              <Button tone="primary" size="lg" block>
                Checkout
              </Button>
            </Link>
          </footer>
        )}
      </div>
    </div>
  );
}
