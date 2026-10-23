import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, EmptyState } from '@biznexa/ui';
import { consultantCategories, consultationTypes, type PublicConsultantDirectory } from '@biznexa/types';
import { api } from '@/lib/api';
import { ConsultantCard, categoryNames } from './consultant-card';
import { QuickFilters } from './quick-filters';

export const metadata: Metadata = {
  title: 'Find a Consultant | BizNexa',
  description: 'Browse verified CAs, CSs, lawyers and business consultants. Compare expertise, fees and availability, then book online.',
  alternates: { canonical: '/consultants' },
};

type Search = Record<string, string | string[] | undefined>;

function queryString(query: Search) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value) params.set(key, value);
  }
  return params.toString();
}

function pageHref(query: Search, page: number) {
  const params = new URLSearchParams(queryString(query));
  if (page <= 1) params.delete('page'); else params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/consultants?${qs}` : '/consultants';
}

export default async function ConsultantsPage({ searchParams }: Readonly<{ searchParams: Promise<Search> }>) {
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []));
  const apiQuery: Record<string, string | undefined> = {
    category: query.category,
    state: query.state,
    city: query.city,
    area: query.area,
    minRating: query.minRating,
    minExperience: query.minExperience,
    minFee: query.minFee ? String(Math.round(Number(query.minFee) * 100)) : undefined,
    maxFee: query.maxFee ? String(Math.round(Number(query.maxFee) * 100)) : undefined,
    language: query.language,
    consultationType: query.consultationType,
    availableToday: query.availableToday,
    sort: query.sort,
    page: query.page,
    limit: query.limit,
  };
  let result: PublicConsultantDirectory | null = null;
  let error: string | null = null;
  try {
    result = await api<PublicConsultantDirectory>(`/public/consultants?${new URLSearchParams(Object.entries(apiQuery).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`, { revalidate: 0 });
  } catch {
    error = 'We could not load consultants right now. Please try again.';
  }
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 12);
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / limit));
  const queryText = queryString(query);
  const retryHref = queryText ? `/consultants?${queryText}` : '/consultants';
  let resultSummary = '';
  if (result) {
    resultSummary = `${result.total} consultant`;
    if (result.total !== 1) resultSummary += 's';
  }

  return (
    <Container className="py-8 sm:py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Verified professionals</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Find a consultant</h1>
          <p className="mt-2 max-w-2xl text-muted">Compare expertise, fees and availability, then book a consultation online.</p>
        </div>
        <Link href="/consultants/apply" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-rule px-4 font-semibold hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Apply as a consultant</Link>
      </div>

      <form method="get" className="mt-7 rounded-xl border border-rule bg-white p-4 sm:p-5" aria-label="Filter consultants">
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium">Category<select name="category" defaultValue={query.category ?? ''} className="mt-1 block min-h-11 w-full rounded-md border border-rule bg-white px-3"><option value="">All categories</option>{consultantCategories.map((c) => <option key={c} value={c}>{categoryNames[c]}</option>)}</select></label>
          <label className="text-sm font-medium">State<input name="state" defaultValue={query.state} placeholder="Any state" className="mt-1 block min-h-11 w-full rounded-md border border-rule px-3" /></label>
          <label className="text-sm font-medium">City<input name="city" defaultValue={query.city} placeholder="Any city" className="mt-1 block min-h-11 w-full rounded-md border border-rule px-3" /></label>
          <label className="text-sm font-medium">Area<input name="area" defaultValue={query.area} placeholder="Any area" className="mt-1 block min-h-11 w-full rounded-md border border-rule px-3" /></label>
          <label className="text-sm font-medium">Minimum rating<select name="minRating" defaultValue={query.minRating ?? ''} className="mt-1 block min-h-11 w-full rounded-md border border-rule bg-white px-3"><option value="">Any rating</option>{['3', '4', '4.5'].map((v) => <option key={v} value={v}>{v}+ stars</option>)}</select></label>
          <label className="text-sm font-medium">Experience<input name="minExperience" type="number" min="0" max="60" defaultValue={query.minExperience} placeholder="Any years" className="mt-1 block min-h-11 w-full rounded-md border border-rule px-3" /></label>
          <label className="text-sm font-medium">Minimum fee (₹)<input name="minFee" type="number" min="0" step="1" defaultValue={query.minFee} placeholder="No minimum" className="mt-1 block min-h-11 w-full rounded-md border border-rule px-3" /></label>
          <label className="text-sm font-medium">Maximum fee (₹)<input name="maxFee" type="number" min="0" step="1" defaultValue={query.maxFee} placeholder="No maximum" className="mt-1 block min-h-11 w-full rounded-md border border-rule px-3" /></label>
          <label className="text-sm font-medium">Language<input name="language" defaultValue={query.language} placeholder="Any language" className="mt-1 block min-h-11 w-full rounded-md border border-rule px-3" /></label>
          <label className="text-sm font-medium">Consultation type<select name="consultationType" defaultValue={query.consultationType ?? ''} className="mt-1 block min-h-11 w-full rounded-md border border-rule bg-white px-3"><option value="">Any type</option>{consultationTypes.map((t) => <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>)}</select></label>
          <label className="text-sm font-medium">Availability<select name="availableToday" defaultValue={query.availableToday ?? ''} className="mt-1 block min-h-11 w-full rounded-md border border-rule bg-white px-3"><option value="">Any day</option><option value="true">Available today</option><option value="false">Not available today</option></select></label>
          <label className="text-sm font-medium">Sort by<select name="sort" defaultValue={query.sort ?? 'rating'} className="mt-1 block min-h-11 w-full rounded-md border border-rule bg-white px-3"><option value="rating">Top rated</option><option value="experience">Experience</option><option value="fee_low">Fee: low to high</option><option value="fee_high">Fee: high to low</option></select></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="min-h-11 rounded-md bg-ink px-5 font-semibold text-white hover:opacity-90" type="submit">Apply filters</button>
          <Link href="/consultants" className="inline-flex min-h-11 items-center rounded-md px-4 font-semibold text-muted hover:bg-paper">Clear all</Link>
          <span className="self-center text-sm text-muted">{resultSummary}</span>
        </div>
      </form>

      <QuickFilters query={query} />

      {error ? <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-red-900" role="alert">{error} <a className="ml-1 font-semibold underline" href={retryHref}>Retry</a></div> : null}
      {!error && result?.items.length === 0 ? <div className="mt-8"><EmptyState title="No consultants found" description="Try changing or clearing some filters." /></div> : null}
      {!error && result && result.items.length > 0 ? <>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {result.items.map((consultant) => <ConsultantCard key={consultant.id} consultant={consultant} />)}
        </div>
        <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Consultant pages">
          {page > 1 && <Link className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 font-semibold" href={pageHref(query, page - 1)}>Previous</Link>}
          <span className="px-2 text-sm text-muted">Page {page} of {totalPages}</span>
          {page < totalPages && <Link className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 font-semibold" href={pageHref(query, page + 1)}>Next</Link>}
        </nav>
      </> : null}
    </Container>
  );
}
