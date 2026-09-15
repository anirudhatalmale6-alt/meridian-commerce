import { describe, expect, it } from 'vitest';
import type { Product, Variant } from './types';
import { defaultSelection, repairSelection, resolveVariant } from './variants';

/**
 * A two-axis product modelled on the real seed data, because the interesting
 * case is a SPARSE variant matrix: Bone and Ink come in every size, Moss only
 * in M and L. A picker tested against a full matrix passes while being unusable
 * on the sparse one, which is what most catalogues actually look like.
 */
const SIZE = { S: 'v-s', M: 'v-m', L: 'v-l', XL: 'v-xl' };
const COLOUR = { Bone: 'v-bone', Ink: 'v-ink', Moss: 'v-moss' };

function variant(
  id: string,
  optionValueIds: string[],
  stock: number,
  priceCents = 3200,
): Variant {
  return {
    id,
    sku: id.toUpperCase(),
    priceCents,
    compareAtCents: null,
    stock,
    inStock: stock > 0,
    optionValueIds,
    label: id,
  };
}

const product: Product = {
  id: 'p1',
  slug: 'tee',
  title: 'Tee',
  description: '',
  brand: null,
  category: null,
  images: [],
  options: [
    {
      id: 'opt-size',
      name: 'Size',
      values: [
        { id: SIZE.S, value: 'S' },
        { id: SIZE.M, value: 'M' },
        { id: SIZE.L, value: 'L' },
        { id: SIZE.XL, value: 'XL' },
      ],
    },
    {
      id: 'opt-colour',
      name: 'Colour',
      values: [
        { id: COLOUR.Bone, value: 'Bone' },
        { id: COLOUR.Ink, value: 'Ink' },
        { id: COLOUR.Moss, value: 'Moss' },
      ],
    },
  ],
  variants: [
    // The first variant is deliberately OUT OF STOCK, so defaultSelection has
    // to skip past it rather than landing on the first row it sees.
    variant('s-bone', [SIZE.S, COLOUR.Bone], 0),
    variant('m-bone', [SIZE.M, COLOUR.Bone], 15),
    variant('l-bone', [SIZE.L, COLOUR.Bone], 2),
    variant('xl-bone', [SIZE.XL, COLOUR.Bone], 0),
    variant('s-ink', [SIZE.S, COLOUR.Ink], 12),
    variant('m-ink', [SIZE.M, COLOUR.Ink], 19),
    variant('l-ink', [SIZE.L, COLOUR.Ink], 7),
    variant('xl-ink', [SIZE.XL, COLOUR.Ink], 4),
    // Moss exists ONLY in M and L.
    variant('m-moss', [SIZE.M, COLOUR.Moss], 6, 3300),
    variant('l-moss', [SIZE.L, COLOUR.Moss], 3, 3300),
  ],
  priceFromCents: 3200,
  priceToCents: 3300,
  totalStock: 68,
  variantCount: 10,
};

describe('resolveVariant', () => {
  it('returns null until every axis is chosen', () => {
    expect(resolveVariant(product, {})).toBeNull();
    expect(resolveVariant(product, { 'opt-size': SIZE.M })).toBeNull();
  });

  it('resolves a complete selection to exactly one variant', () => {
    const found = resolveVariant(product, {
      'opt-size': SIZE.M,
      'opt-colour': COLOUR.Moss,
    });
    expect(found?.id).toBe('m-moss');
    expect(found?.priceCents).toBe(3300);
  });

  it('returns null for a combination that is not manufactured', () => {
    // S + Moss does not exist.
    const found = resolveVariant(product, {
      'opt-size': SIZE.S,
      'opt-colour': COLOUR.Moss,
    });
    expect(found).toBeNull();
  });
});

describe('defaultSelection', () => {
  it('preselects an IN-STOCK variant, skipping the sold-out first row', () => {
    const selection = defaultSelection(product);
    const resolved = resolveVariant(product, selection);

    expect(resolved).not.toBeNull();
    expect(resolved!.inStock).toBe(true);
    // s-bone is first in the array but has no stock, so it must not be chosen.
    expect(resolved!.id).not.toBe('s-bone');
  });

  it('falls back to the first variant when nothing is in stock', () => {
    const soldOut: Product = {
      ...product,
      variants: product.variants.map((v) => ({ ...v, stock: 0, inStock: false })),
    };
    const resolved = resolveVariant(soldOut, defaultSelection(soldOut));
    // Still resolves to something, so the page can show a price and say
    // "sold out" rather than rendering an empty shell.
    expect(resolved).not.toBeNull();
  });

  it('returns an empty selection for a product with no variants', () => {
    expect(defaultSelection({ ...product, variants: [] })).toEqual({});
  });
});

/**
 * The dead end this function exists to prevent: the default lands on Size=S,
 * Moss is not made in S, so a picker that merely disables what does not combine
 * leaves Moss permanently unreachable.
 */
describe('repairSelection', () => {
  it('drags the other axis to a size the chosen colour is actually made in', () => {
    const start = { 'opt-size': SIZE.S, 'opt-colour': COLOUR.Bone };

    const next = repairSelection(product, start, 'opt-colour', COLOUR.Moss);

    expect(next['opt-colour']).toBe(COLOUR.Moss);
    // S had to move, because S/Moss does not exist.
    expect([SIZE.M, SIZE.L]).toContain(next['opt-size']);
    expect(resolveVariant(product, next)).not.toBeNull();
  });

  it('prefers a repaired combination that is in stock', () => {
    // Make L/Moss the only in-stock Moss option.
    const scarce: Product = {
      ...product,
      variants: product.variants.map((v) =>
        v.id === 'm-moss' ? { ...v, stock: 0, inStock: false } : v,
      ),
    };

    const next = repairSelection(
      scarce,
      { 'opt-size': SIZE.S, 'opt-colour': COLOUR.Bone },
      'opt-colour',
      COLOUR.Moss,
    );

    const resolved = resolveVariant(scarce, next);
    expect(resolved?.id).toBe('l-moss');
    expect(resolved?.inStock).toBe(true);
  });

  it('leaves a surviving choice on the other axis alone', () => {
    // M/Ink -> M/Moss. M is made in Moss, so the size must NOT be disturbed.
    const next = repairSelection(
      product,
      { 'opt-size': SIZE.M, 'opt-colour': COLOUR.Ink },
      'opt-colour',
      COLOUR.Moss,
    );

    expect(next['opt-size']).toBe(SIZE.M);
    expect(resolveVariant(product, next)?.id).toBe('m-moss');
  });

  it('never gives up the value that was actually clicked', () => {
    // Every axis value, from every starting point, must end up selected.
    for (const size of Object.values(SIZE)) {
      for (const colour of Object.values(COLOUR)) {
        const start = { 'opt-size': size, 'opt-colour': colour };

        for (const target of Object.values(COLOUR)) {
          const next = repairSelection(product, start, 'opt-colour', target);
          expect(next['opt-colour']).toBe(target);
        }
        for (const target of Object.values(SIZE)) {
          const next = repairSelection(product, start, 'opt-size', target);
          expect(next['opt-size']).toBe(target);
        }
      }
    }
  });

  it('always lands on a real variant, from every starting point', () => {
    // The property that matters: no sequence of clicks can leave the picker in
    // a state where nothing resolves and the button is stuck disabled.
    for (const size of Object.values(SIZE)) {
      for (const colour of Object.values(COLOUR)) {
        const start = { 'opt-size': size, 'opt-colour': colour };

        for (const target of [...Object.values(COLOUR)]) {
          const next = repairSelection(product, start, 'opt-colour', target);
          expect(
            resolveVariant(product, next),
            `clicking colour ${target} from ${JSON.stringify(start)} resolved to nothing`,
          ).not.toBeNull();
        }
        for (const target of [...Object.values(SIZE)]) {
          const next = repairSelection(product, start, 'opt-size', target);
          expect(
            resolveVariant(product, next),
            `clicking size ${target} from ${JSON.stringify(start)} resolved to nothing`,
          ).not.toBeNull();
        }
      }
    }
  });

  it('is a no-op for a value that appears in no variant at all', () => {
    const next = repairSelection(
      product,
      { 'opt-size': SIZE.M, 'opt-colour': COLOUR.Ink },
      'opt-colour',
      'v-does-not-exist',
    );
    // The click is recorded but nothing is invented around it; the component
    // disables such a value, so this is only a safety net.
    expect(next['opt-colour']).toBe('v-does-not-exist');
    expect(resolveVariant(product, next)).toBeNull();
  });

  it('handles a single-axis product', () => {
    const single: Product = {
      ...product,
      options: [product.options[0]!],
      variants: [
        variant('s', [SIZE.S], 5),
        variant('m', [SIZE.M], 0),
      ],
    };

    const next = repairSelection(single, { 'opt-size': SIZE.S }, 'opt-size', SIZE.M);
    expect(next['opt-size']).toBe(SIZE.M);
    expect(resolveVariant(single, next)?.id).toBe('m');
  });
});
