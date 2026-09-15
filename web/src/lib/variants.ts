/**
 * Variant selection logic, kept apart from the component that renders it.
 *
 * Two reasons. It is the piece worth unit testing without a DOM, and Vite's
 * fast refresh only works on a module whose exports are all components -- a
 * file mixing helpers with a component reloads the whole tree on every edit.
 */
import type { Product, Variant } from './types';

export interface VariantSelection {
  /** option id -> chosen optionValue id */
  [optionId: string]: string | undefined;
}

/**
 * Resolve a selection to a single variant. Returns null until every axis has
 * been chosen, so "Add to basket" cannot fire on a half-picked combination.
 */
export function resolveVariant(product: Product, selection: VariantSelection): Variant | null {
  const chosen = product.options.map((o) => selection[o.id]);
  if (chosen.some((v) => !v)) return null;
  return (
    product.variants.find((v) =>
      chosen.every((valueId) => valueId !== undefined && v.optionValueIds.includes(valueId)),
    ) ?? null
  );
}

/** First fully in-stock variant, used to preselect something buyable. */
export function defaultSelection(product: Product): VariantSelection {
  const preferred = product.variants.find((v) => v.inStock) ?? product.variants[0] ?? null;
  if (!preferred) return {};

  const selection: VariantSelection = {};
  for (const option of product.options) {
    const match = option.values.find((value) => preferred.optionValueIds.includes(value.id));
    if (match) selection[option.id] = match.id;
  }
  return selection;
}

/**
 * Apply a click on one axis and repair the others so the result always resolves
 * to a real variant.
 *
 * This is the fix for a dead end that a picker built on "disable what does not
 * combine" walks straight into. The tee is stocked in Bone and Ink in every
 * size, but in Moss only in M and L. Preselecting the first in-stock variant
 * lands on Size=S, which makes Moss un-clickable -- so a shopper who wants the
 * moss tee can never reach it without guessing that they must change size
 * first. Nobody guesses that; they conclude the colour is unavailable and
 * leave.
 *
 * So a value that exists anywhere in the product stays clickable, and choosing
 * it drags the other axes to the nearest combination that exists, preferring
 * one that is actually in stock. Clicking Moss moves Size from S to M, which is
 * what the shopper meant.
 */
export function repairSelection(
  product: Product,
  selection: VariantSelection,
  changedOptionId: string,
  valueId: string,
): VariantSelection {
  const next: VariantSelection = { ...selection, [changedOptionId]: valueId };

  // Every variant that honours the click. The clicked value is never given up.
  let candidates = product.variants.filter((v) => v.optionValueIds.includes(valueId));
  if (candidates.length === 0) return next;

  for (const option of product.options) {
    if (option.id === changedOptionId) continue;

    const current = next[option.id];
    const kept = current ? candidates.filter((v) => v.optionValueIds.includes(current)) : [];

    if (kept.length > 0) {
      // The existing pick on this axis survives the click; leave it alone.
      candidates = kept;
      continue;
    }

    // It does not survive. Move this axis to a value that does, preferring a
    // combination with stock over one without.
    const best = [...candidates].sort((a, b) => Number(b.inStock) - Number(a.inStock))[0];
    if (!best) continue;

    const replacement = option.values.find((v) => best.optionValueIds.includes(v.id));
    if (replacement) {
      next[option.id] = replacement.id;
      candidates = candidates.filter((v) => v.optionValueIds.includes(replacement.id));
    }
  }

  return next;
}
