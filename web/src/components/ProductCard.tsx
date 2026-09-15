import { Link } from 'react-router-dom';
import { formatMoney } from '../lib/money';
import type { Product } from '../lib/types';

/**
 * Catalogue tile. Deliberately honest about state: a product whose every
 * variant is gone says so on the card, rather than letting the customer click
 * through and discover it on the product page.
 */
export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const soldOut = product.totalStock === 0;
  const hasRange = product.priceToCents > product.priceFromCents;
  const onSale = product.variants.some(
    (v) => v.compareAtCents !== null && v.compareAtCents > v.priceCents,
  );

  return (
    <article
      className="rise group"
      // Staggered entrance, capped so the last tile on a long page is not held
      // back by a second and a half of delay.
      style={{ animationDelay: `${Math.min(index * 55, 440)}ms` }}
    >
      <Link to={`/product/${product.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden border border-paper-edge bg-paper-deep">
          <img
            src={product.images[0]?.url ?? ''}
            alt={product.images[0]?.alt ?? product.title}
            // Lazy below the fold; a 12-tile grid should not block paint on
            // twelve images. Explicit dimensions prevent layout shift.
            loading={index < 4 ? 'eager' : 'lazy'}
            width={800}
            height={800}
            className={`h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] ${
              soldOut ? 'opacity-45 saturate-50' : ''
            }`}
          />

          {soldOut && (
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-ink/85 py-2 text-center text-[0.625rem] font-semibold uppercase tracking-[0.22em] text-paper">
              Sold out
            </span>
          )}

          {!soldOut && onSale && (
            <span className="absolute left-0 top-0 bg-rust px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-paper">
              Reduced
            </span>
          )}
        </div>

        <div className="mt-3.5">
          {product.brand && <p className="label-xs">{product.brand}</p>}
          <h3 className="mt-1 font-display text-[1.0625rem] leading-snug text-ink">
            <span className="link-slide">{product.title}</span>
          </h3>
          <p className="nums mt-1.5 text-sm text-ink-soft">
            {hasRange ? (
              <>
                {formatMoney(product.priceFromCents)}
                <span className="text-ink-faint"> – </span>
                {formatMoney(product.priceToCents)}
              </>
            ) : (
              formatMoney(product.priceFromCents)
            )}
            {product.variantCount > 1 && (
              <span className="ml-2 text-xs text-ink-faint">{product.variantCount} options</span>
            )}
          </p>
        </div>
      </Link>
    </article>
  );
}
