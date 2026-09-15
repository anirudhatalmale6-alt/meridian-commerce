import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import type { Category, Facets, ProductList } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { Button, EmptyState, Eyebrow, Notice, Pagination, Skeleton } from '../components/ui';

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price, low to high' },
  { value: 'price_desc', label: 'Price, high to low' },
  { value: 'title_asc', label: 'Name, A–Z' },
];

export function CatalogPage() {
  /**
   * Filter state lives in the URL, not in component state.
   *
   * That makes a filtered view shareable, bookmarkable, and survivable across
   * a back button -- all of which a shop needs, and none of which you get from
   * useState. It also means the query key is derived from the URL, so TanStack
   * Query caches each distinct filter combination on its own.
   */
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const brand = params.get('brand') ?? '';
  const maxPrice = params.get('maxPrice') ?? '';
  const inStock = params.get('inStock') === 'true';
  const sort = params.get('sort') ?? 'newest';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  // The search box is debounced locally so typing does not fire a request per
  // keystroke, but the committed value still ends up in the URL.
  const [searchDraft, setSearchDraft] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    setSearchDraft(q);
  }, [q]);

  useEffect(() => {
    if (searchDraft === q) return;
    const timer = setTimeout(() => {
      update({ q: searchDraft || null, page: null });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  function update(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  }

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (category) sp.set('category', category);
    if (brand) sp.set('brand', brand);
    if (maxPrice) sp.set('maxPrice', maxPrice);
    if (inStock) sp.set('inStock', 'true');
    sp.set('sort', sort);
    sp.set('page', String(page));
    sp.set('perPage', '12');
    return sp.toString();
  }, [q, category, brand, maxPrice, inStock, sort, page]);

  const products = useQuery<ProductList>({
    queryKey: ['products', queryString],
    queryFn: () => api.get<ProductList>(`/catalog/products?${queryString}`),
    // Keeps the previous page on screen while the next one loads, instead of
    // blanking the grid on every filter change.
    placeholderData: (previous) => previous,
  });

  const categories = useQuery<{ categories: Category[] }>({
    queryKey: ['categories'],
    queryFn: () => api.get('/catalog/categories'),
    staleTime: 10 * 60 * 1000,
  });

  const facets = useQuery<Facets>({
    queryKey: ['facets'],
    queryFn: () => api.get('/catalog/facets'),
    staleTime: 10 * 60 * 1000,
  });

  const activeFilters = [q, category, brand, maxPrice, inStock ? 'inStock' : ''].filter(
    Boolean,
  ).length;

  return (
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
      {/* ---- Masthead ----------------------------------------------------
           Kept deliberately shallow. An editorial hero is worth having, but a
           shop where the first product sits below the fold is a shop nobody
           scrolls; the top row of tiles has to be visible on a laptop. */}
      <section className="border-b border-paper-edge py-9 sm:py-12">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-10">
          <div>
            <Eyebrow>Catalogue No. 01 — Autumn</Eyebrow>
            <h1 className="rise mt-3.5 font-display text-[clamp(2.25rem,5.5vw,3.75rem)] font-semibold leading-[1.0] tracking-[-0.03em] text-ink">
              Things made <span className="italic text-rust">properly</span>,
              <br className="hidden sm:block" /> sent by post.
            </h1>
          </div>

          <p
            className="rise max-w-md text-[0.9375rem] leading-relaxed text-ink-soft"
            style={{ animationDelay: '120ms' }}
          >
            A short list of everyday objects chosen because they work — a kettle that pours where
            you point it, a tee that survives the wash, a lamp that holds its position without being
            tightened. No seasonal churn, no filler.
          </p>
        </div>
      </section>

      <div className="grid gap-10 py-10 lg:grid-cols-[210px_1fr] lg:gap-14">
        {/* ---- Filters ---------------------------------------------------
             On a phone the search box stays put but the facet rail collapses
             behind a toggle. Left expanded, it filled the entire first screen
             and pushed every product out of sight -- the exact opposite of what
             somebody arriving on a shop wants to see. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-5 lg:space-y-7">
            <div>
              <label htmlFor="search" className="label-xs mb-2 block">
                Search
              </label>
              <input
                id="search"
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Kettle, bag, SKU…"
                className="w-full border border-paper-edge bg-paper px-3 py-2.5 text-sm placeholder:text-ink-faint/60 focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-rust"
              />
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-controls="facets"
              className="flex w-full items-center justify-between border border-paper-edge px-3 py-2.5 text-[0.8125rem] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink lg:hidden"
            >
              <span>
                Filter
                {activeFilters > 0 && (
                  <span className="nums ml-2 bg-rust px-1.5 py-0.5 text-[0.625rem] text-paper">
                    {activeFilters}
                  </span>
                )}
              </span>
              <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
            </button>
          </div>

          <div
            id="facets"
            className={`space-y-7 ${filtersOpen ? 'mt-6 block' : 'hidden'} lg:mt-7 lg:block`}
          >
            <div>
              <p className="label-xs mb-2.5">Category</p>
              <ul className="space-y-1.5">
                <li>
                  <button
                    onClick={() => update({ category: null, page: null })}
                    className={`link-slide text-sm ${category === '' ? 'text-rust' : 'text-ink-soft hover:text-ink'}`}
                  >
                    All goods
                  </button>
                </li>
                {categories.data?.categories.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => update({ category: c.slug, page: null })}
                      className={`link-slide text-sm ${category === c.slug ? 'text-rust' : 'text-ink-soft hover:text-ink'}`}
                    >
                      {c.name}
                      <span className="nums ml-1.5 text-xs text-ink-faint">{c.productCount}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {facets.data && facets.data.brands.length > 0 && (
              <div>
                <p className="label-xs mb-2.5">Maker</p>
                <ul className="space-y-1.5">
                  {facets.data.brands.map((b) => (
                    <li key={b}>
                      <button
                        onClick={() => update({ brand: brand === b ? null : b, page: null })}
                        className={`link-slide text-sm ${brand === b ? 'text-rust' : 'text-ink-soft hover:text-ink'}`}
                      >
                        {b}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {facets.data && facets.data.maxPriceCents > 0 && (
              <div>
                <label htmlFor="price" className="label-xs mb-2.5 block">
                  Up to{' '}
                  <span className="nums normal-case tracking-normal text-ink">
                    {formatMoney(maxPrice ? Number(maxPrice) * 100 : facets.data.maxPriceCents)}
                  </span>
                </label>
                <input
                  id="price"
                  type="range"
                  min={Math.floor(facets.data.minPriceCents / 100)}
                  max={Math.ceil(facets.data.maxPriceCents / 100)}
                  value={maxPrice || Math.ceil(facets.data.maxPriceCents / 100)}
                  onChange={(e) => update({ maxPrice: e.target.value, page: null })}
                  className="w-full accent-rust"
                />
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={inStock}
                onChange={(e) =>
                  update({
                    inStock: e.target.checked ? 'true' : null,
                    page: null,
                  })
                }
                className="h-4 w-4 accent-rust"
              />
              In stock only
            </label>

            {activeFilters > 0 && (
              <Button tone="quiet" size="sm" block onClick={() => setParams(new URLSearchParams())}>
                Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </aside>

        {/* ---- Grid ------------------------------------------------------ */}
        <section>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-paper-edge pb-4">
            <p className="nums text-sm text-ink-soft">
              {products.isLoading ? (
                'Loading…'
              ) : (
                <>
                  <span className="text-ink">{products.data?.total ?? 0}</span>{' '}
                  {products.data?.total === 1 ? 'product' : 'products'}
                  {q && <span className="text-ink-faint"> matching “{q}”</span>}
                </>
              )}
            </p>

            <div className="flex items-center gap-2.5">
              <label htmlFor="sort" className="label-xs">
                Sort
              </label>
              <select
                id="sort"
                value={sort}
                onChange={(e) => update({ sort: e.target.value, page: null })}
                className="border border-paper-edge bg-paper px-3 py-1.5 text-sm focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-rust"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {products.isError && (
            <Notice>
              The catalogue could not be loaded. The API may not be running — check that the server
              is up, then reload.
            </Notice>
          )}

          {products.isLoading && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="aspect-square w-full" />
                  <Skeleton className="mt-3.5 h-3 w-16" />
                  <Skeleton className="mt-2 h-4 w-full" />
                  <Skeleton className="mt-2 h-3 w-20" />
                </div>
              ))}
            </div>
          )}

          {products.data && products.data.items.length === 0 && (
            <EmptyState
              title="Nothing matches that."
              body="No product fits every filter you have set. Try widening the price, or clearing the search."
              action={{ to: '/', label: 'Clear filters' }}
            />
          )}

          {products.data && products.data.items.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-3">
                {products.data.items.map((product, i) => (
                  <ProductCard key={product.id} product={product} index={i} />
                ))}
              </div>

              {/* The API tells us when a price sort only held within the page.
                  Saying so beats letting somebody discover it and file a bug. */}
              {products.data.sortedWithinPageOnly && products.data.totalPages > 1 && (
                <p className="mt-6 text-xs text-ink-faint">
                  Price sorting applies within each page while the catalogue is this small; a
                  denormalised price column is the fix once it grows.
                </p>
              )}

              <div className="mt-12">
                <Pagination
                  page={products.data.page}
                  totalPages={products.data.totalPages}
                  onPage={(p) => {
                    update({ page: String(p) });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
