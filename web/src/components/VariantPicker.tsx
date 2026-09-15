import { useMemo } from 'react';
import type { Product } from '../lib/types';
import type { VariantSelection } from '../lib/variants';
import { repairSelection } from '../lib/variants';

export function VariantPicker({
  product,
  selection,
  onChange,
}: {
  product: Product;
  selection: VariantSelection;
  onChange: (next: VariantSelection) => void;
}) {
  /**
   * Three states per option value, and they are genuinely different things:
   *
   *  - `madeAtAll`  : the product has at least one variant with this value.
   *                   Only a value failing this is disabled, and with sane data
   *                   that never happens.
   *  - `fitsCurrent`: a variant exists combining it with the current picks on
   *                   the other axes. Failing this is shown dimmed -- clicking
   *                   still works and repairs the other axes.
   *  - `inStock`    : such a variant has stock. Failing this gets the strike.
   */
  const availability = useMemo(() => {
    const map = new Map<string, { madeAtAll: boolean; fitsCurrent: boolean; inStock: boolean }>();

    for (const option of product.options) {
      for (const value of option.values) {
        const madeAtAll = product.variants.some((v) => v.optionValueIds.includes(value.id));

        const others = product.options
          .filter((o) => o.id !== option.id)
          .map((o) => selection[o.id])
          .filter((id): id is string => Boolean(id));

        const combined = product.variants.filter(
          (v) =>
            v.optionValueIds.includes(value.id) &&
            others.every((id) => v.optionValueIds.includes(id)),
        );

        map.set(value.id, {
          madeAtAll,
          fitsCurrent: combined.length > 0,
          inStock: combined.some((v) => v.inStock),
        });
      }
    }
    return map;
  }, [product, selection]);

  return (
    <div className="space-y-5">
      {product.options.map((option) => {
        const activeValueId = selection[option.id];
        return (
          <fieldset key={option.id}>
            <legend className="label-xs mb-2">
              {option.name}
              {activeValueId && (
                <span className="ml-2 normal-case tracking-normal text-ink">
                  {option.values.find((v) => v.id === activeValueId)?.value}
                </span>
              )}
            </legend>

            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const state = availability.get(value.id) ?? {
                  madeAtAll: false,
                  fitsCurrent: false,
                  inStock: false,
                };
                const isActive = activeValueId === value.id;
                const disabled = !state.madeAtAll;

                const title = !state.madeAtAll
                  ? `${value.value} is not made`
                  : !state.fitsCurrent
                    ? `${value.value} — we will adjust your other choices to match`
                    : state.inStock
                      ? value.value
                      : `${value.value} — out of stock`;

                return (
                  <button
                    key={value.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={isActive}
                    title={title}
                    onClick={() =>
                      onChange(repairSelection(product, selection, option.id, value.id))
                    }
                    className={`relative min-w-11 border px-3.5 py-2 text-[0.8125rem] transition-all duration-150 ${
                      isActive
                        ? 'border-ink bg-ink text-paper'
                        : 'border-paper-edge text-ink hover:border-ink'
                    } ${disabled ? 'cursor-not-allowed opacity-30' : ''} ${
                      // Dimmed: real, clickable, but needs the other axes moved.
                      !disabled && !state.fitsCurrent && !isActive ? 'opacity-55' : ''
                    } ${
                      // Struck through: this combination exists and is sold out.
                      // Visually distinct from "needs adjusting" on purpose.
                      !disabled && state.fitsCurrent && !state.inStock && !isActive
                        ? 'bg-[linear-gradient(to_top_right,transparent_47%,var(--color-ink-faint)_47%,var(--color-ink-faint)_53%,transparent_53%)]'
                        : ''
                    }`}
                  >
                    {value.value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
