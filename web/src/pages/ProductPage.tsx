import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import { formatMoney } from '../lib/money';
import type { Product } from '../lib/types';
import { useCartMutations } from '../hooks/useCart';
import { VariantPicker } from '../components/VariantPicker';
import { defaultSelection, resolveVariant, type VariantSelection } from '../lib/variants';
import { Button, Notice, Skeleton } from '../components/ui';

/**
 * What the shopper has actively chosen on THIS product.
 *
 * Tagged with the product id so navigating to another product falls back to
 * that product's own default without any reset logic. An earlier version did
 * this in a useEffect that called setSelection when the query resolved, which
 * works but triggers a second render pass before paint on every product view --
 * and leaves a real bug if the reset is ever forgotten: option ids from the
 * previous product linger and nothing resolves. Deriving it during render
 * removes both problems.
 */
interface Chosen {
  productId: string;
  selection: VariantSelection;
  quantity: number;
}

export function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const { openCart } = useOutletContext<{ openCart: () => void }>();
  const { add } = useCartMutations();

  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [addedTo, setAddedTo] = useState<string | null>(null);

  const product = useQuery<{ product: Product }>({
    queryKey: ['product', slug],
    queryFn: () => api.get(`/catalog/products/${slug}`),
    enabled: Boolean(slug),
  });

  if (product.isLoading) {
    return (
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-12 sm:px-8 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full" />
        <div className="space-y-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (product.isError) {
    const notFound = product.error instanceof ApiError && product.error.status === 404;
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-3xl text-ink">
          {notFound ? 'We do not stock that.' : 'Something went wrong.'}
        </h1>
        <p className="mt-3 text-sm text-ink-soft">
          {notFound
            ? 'That product may have been discontinued, or the link is wrong.'
            : 'The product could not be loaded. Please try again.'}
        </p>
        <Link
          to="/"
          className="mt-7 inline-block border border-ink px-5 py-2.5 text-[0.8125rem] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          Back to the catalogue
        </Link>
      </div>
    );
  }

  const p = product.data!.product;

  // Derived, not stored: the shopper's picks win if they are for this product,
  // otherwise this product's own sensible default.
  const isThisProduct = chosen?.productId === p.id;
  const selection = isThisProduct ? chosen.selection : defaultSelection(p);
  const quantity = isThisProduct ? chosen.quantity : 1;
  const justAdded = addedTo === p.id;

  const setSelection = (next: VariantSelection) =>
    setChosen({ productId: p.id, selection: next, quantity });
  const setQuantity = (next: number) => setChosen({ productId: p.id, selection, quantity: next });

  const variant = resolveVariant(p, selection);
  const image = p.images[0];

  // Every reason the button might be unavailable, named. A disabled button with
  // no explanation is the most common dead end in a variant-heavy shop.
  const blocked = !variant
    ? 'Choose an option above'
    : !variant.inStock
      ? 'Sold out in this combination'
      : variant.stock < quantity
        ? `Only ${variant.stock} left`
        : null;

  const onSale = variant?.compareAtCents != null && variant.compareAtCents > variant.priceCents;

  return (
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
      <nav className="flex items-center gap-2 border-b border-paper-edge py-4 text-xs text-ink-faint">
        <Link to="/" className="link-slide hover:text-ink">
          Shop
        </Link>
        {p.category && (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/?category=${p.category.slug}`} className="link-slide hover:text-ink">
              {p.category.name}
            </Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span className="text-ink-soft">{p.title}</span>
      </nav>

      <div className="grid gap-8 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:py-10">
        <div className="rise">
          <div className="aspect-square overflow-hidden border border-paper-edge bg-paper-deep">
            <img
              src={image?.url ?? ''}
              alt={image?.alt ?? p.title}
              width={800}
              height={800}
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        <div className="rise lg:pt-6" style={{ animationDelay: '110ms' }}>
          {p.brand && <p className="label-xs">{p.brand}</p>}

          <h1 className="mt-2.5 font-display text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.025em] text-ink">
            {p.title}
          </h1>

          <div className="nums mt-5 flex items-baseline gap-3">
            <span className="font-display text-3xl text-ink">
              {formatMoney(variant?.priceCents ?? p.priceFromCents)}
            </span>
            {onSale && (
              <span className="text-lg text-ink-faint line-through">
                {formatMoney(variant!.compareAtCents!)}
              </span>
            )}
            {onSale && (
              <span className="bg-rust px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-paper">
                Save {formatMoney(variant!.compareAtCents! - variant!.priceCents)}
              </span>
            )}
          </div>

          <p className="mt-6 max-w-prose text-[0.9375rem] leading-relaxed text-ink-soft">
            {p.description}
          </p>

          <div className="mt-9 border-t border-paper-edge pt-8">
            {p.options.length > 0 && (
              <VariantPicker product={p} selection={selection} onChange={setSelection} />
            )}

            <div className="mt-7 flex flex-wrap items-end gap-4">
              <div>
                <p className="label-xs mb-2">Quantity</p>
                <div className="flex items-center border border-paper-edge">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                    className="px-3.5 py-2.5 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:opacity-35"
                  >
                    −
                  </button>
                  <span className="nums min-w-10 text-center text-sm">{quantity}</span>
                  <button
                    onClick={() => setQuantity(Math.min(variant?.stock ?? 99, quantity + 1))}
                    disabled={!variant || quantity >= variant.stock}
                    aria-label="Increase quantity"
                    className="px-3.5 py-2.5 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:opacity-35"
                  >
                    +
                  </button>
                </div>
              </div>

              <Button
                size="lg"
                tone="ink"
                loading={add.isPending}
                disabled={Boolean(blocked)}
                onClick={() => {
                  if (!variant) return;
                  add.mutate(
                    { variantId: variant.id, quantity },
                    {
                      onSuccess: () => {
                        setAddedTo(p.id);
                        openCart();
                      },
                    },
                  );
                }}
                className="flex-1 min-w-[190px]"
              >
                {blocked ?? 'Add to basket'}
              </Button>
            </div>

            {variant && variant.inStock && variant.stock <= 5 && (
              <p className="nums mt-3.5 text-sm text-rust">
                Only {variant.stock} left of {variant.sku}.
              </p>
            )}

            {add.isError && (
              <div className="mt-4">
                <Notice>
                  {add.error instanceof ApiError
                    ? add.error.message
                    : 'That could not be added to your basket.'}
                </Notice>
              </div>
            )}

            {justAdded && !add.isError && !add.isPending && (
              <div className="mt-4">
                <Notice tone="success">
                  Added to your basket. It is saved to your account, so it will still be there next
                  time you visit.
                </Notice>
              </div>
            )}
          </div>

          <dl className="mt-10 divide-y divide-paper-edge border-t border-paper-edge text-sm">
            {variant && (
              <div className="flex justify-between py-3">
                <dt className="label-xs">SKU</dt>
                <dd className="nums text-ink-soft">{variant.sku}</dd>
              </div>
            )}
            {p.category && (
              <div className="flex justify-between py-3">
                <dt className="label-xs">Category</dt>
                <dd className="text-ink-soft">{p.category.name}</dd>
              </div>
            )}
            <div className="flex justify-between py-3">
              <dt className="label-xs">Availability</dt>
              <dd className="nums text-ink-soft">
                {p.totalStock > 0 ? `${p.totalStock} in stock` : 'Out of stock'}
              </dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="label-xs">Delivery</dt>
              <dd className="text-ink-soft">Free over {formatMoney(7500)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
