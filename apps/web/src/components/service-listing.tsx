import Link from 'next/link';
import { ServiceCard } from './service-card';
import { AutoSubmitForm } from './auto-submit-form';
import { EmptyState, Select, buttonClass } from '@biznexa/ui';
import type { CategorySummary, ServiceList } from '@/lib/api';

export interface ListingParams {
  q?: string;
  subcategory?: string;
  category?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  popular?: string;
  page?: string;
}

const PRICE_BANDS = [
  { label: 'Any price', min: '', max: '' },
  { label: 'Under ₹2,000', min: '', max: '2000' },
  { label: '₹2,000 – ₹10,000', min: '2000', max: '10000' },
  { label: '₹10,000 – ₹50,000', min: '10000', max: '50000' },
  { label: 'Above ₹50,000', min: '50000', max: '' },
];

export function buildQuery(base: ListingParams, patch: Partial<ListingParams>) {
  const merged = { ...base, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** Listing with filters that work without JavaScript (plain GET form), enhanced to auto-apply. */
export function ServiceListing({
  basePath,
  params,
  data,
  categories,
  category,
}: {
  basePath: string;
  params: ListingParams;
  data: ServiceList;
  categories: CategorySummary[];
  category?: CategorySummary;
}) {
  const band = PRICE_BANDS.findIndex((b) => b.min === (params.minPrice ?? '') && b.max === (params.maxPrice ?? ''));

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
      <aside aria-label="Filters">
        <AutoSubmitForm action={basePath} className="space-y-6 lg:sticky lg:top-24">
          {params.q && <input type="hidden" name="q" value={params.q} />}

          {!category && (
            <Select id="f-category" label="Category" name="category" defaultValue={params.category ?? ''}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}

          {category && category.subcategories.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Service type</legend>
              <div className="space-y-1.5 text-sm">
                {[{ slug: '', name: 'All types' }, ...category.subcategories].map((s) => (
                  <label key={s.slug || 'all'} className="flex items-center gap-2">
                    <input type="radio" name="subcategory" value={s.slug} defaultChecked={(params.subcategory ?? '') === s.slug} className="accent-ink" />
                    {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Starting price</legend>
            <div className="space-y-1.5 text-sm">
              {PRICE_BANDS.map((b, i) => (
                <label key={b.label} className="flex items-center gap-2">
                  <input type="radio" name="price" value={`${b.min}-${b.max}`} defaultChecked={i === Math.max(band, 0)} className="accent-ink" />
                  {b.label}
                </label>
              ))}
            </div>
          </fieldset>

          <Select id="f-sort" label="Sort by" name="sort" defaultValue={params.sort ?? 'popular'}>
            <option value="popular">Most popular</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="name">Name</option>
          </Select>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="popular" value="true" defaultChecked={params.popular === 'true'} className="accent-ink" />
            Popular services only
          </label>

          <noscript>
            <button type="submit" className={buttonClass('ink', 'sm')}>
              Apply filters
            </button>
          </noscript>
        </AutoSubmitForm>
      </aside>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <p aria-live="polite">
            {data.total} service{data.total === 1 ? '' : 's'}
            {params.q ? (
              <>
                {' '}
                matching <span className="font-medium text-night">“{params.q}”</span>{' '}
                <Link href={`${basePath}${buildQuery(params, { q: undefined, page: undefined })}`} className="text-ink underline">
                  Clear search
                </Link>
              </>
            ) : null}
          </p>
        </div>

        {data.items.length === 0 ? (
          <EmptyState
            className="p-10"
            title="No services match these filters."
            description="Try another price range or clear the filters."
            action={
              <Link href={basePath} className={buttonClass('outline', 'sm')}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((s) => (
              <ServiceCard key={s.id} service={s} showCategory={!category} />
            ))}
          </div>
        )}

        {data.pages > 1 && (
          <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-1">
            {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={`${basePath}${buildQuery(params, { page: p === 1 ? undefined : String(p) })}`}
                aria-current={p === data.page ? 'page' : undefined}
                className={`num grid h-10 min-w-10 place-items-center rounded-md border px-3 text-sm ${p === data.page ? 'border-ink bg-ink text-white' : 'border-rule bg-white hover:border-ink'}`}
              >
                {p}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

/** Translate the UI's price-band radio into minPrice/maxPrice for the API. */
export function normalizeParams(sp: Record<string, string | string[] | undefined>): ListingParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) || undefined;
  let minPrice = one('minPrice');
  let maxPrice = one('maxPrice');
  const price = one('price');
  if (price && price.includes('-')) {
    const [a, b] = price.split('-');
    minPrice = a || undefined;
    maxPrice = b || undefined;
  }
  return {
    q: one('q'),
    category: one('category'),
    subcategory: one('subcategory'),
    minPrice: minPrice && /^\d+$/.test(minPrice) ? minPrice : undefined,
    maxPrice: maxPrice && /^\d+$/.test(maxPrice) ? maxPrice : undefined,
    sort: ['popular', 'price_asc', 'price_desc', 'name'].includes(one('sort') ?? '') ? one('sort') : undefined,
    popular: one('popular') === 'true' ? 'true' : undefined,
    page: one('page') && /^\d+$/.test(one('page')!) ? one('page') : undefined,
  };
}

export function apiQuery(p: ListingParams, category?: string) {
  const qs = new URLSearchParams();
  const c = category ?? p.category;
  if (c) qs.set('category', c);
  if (p.subcategory) qs.set('subcategory', p.subcategory);
  if (p.q) qs.set('q', p.q);
  if (p.minPrice) qs.set('minPrice', p.minPrice);
  if (p.maxPrice) qs.set('maxPrice', p.maxPrice);
  if (p.sort) qs.set('sort', p.sort);
  if (p.popular) qs.set('popular', 'true');
  if (p.page) qs.set('page', p.page);
  qs.set('limit', '24');
  return qs.toString();
}
