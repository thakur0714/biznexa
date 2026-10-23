import Link from 'next/link';
import { consultantCategories } from '@biznexa/types';
import { categoryNames } from './consultant-card';

type Query = Record<string, string>;

/** Toggles one filter param on the directory URL, keeping the rest and going back to page 1. */
export function chipHref(query: Query, key: string, value: string) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  if (query[key] === value) params.delete(key); else params.set(key, value);
  params.delete('page');
  const qs = params.toString();
  return qs ? `/consultants?${qs}` : '/consultants';
}

const chips = [
  ...consultantCategories.map((c) => ({ key: 'category', value: c, label: categoryNames[c] })),
  { key: 'availableToday', value: 'true', label: 'Available today' },
  { key: 'minRating', value: '4', label: 'Rated 4+' },
];

export function QuickFilters({ query }: Readonly<{ query: Query }>) {
  return <nav aria-label="Quick filters" className="mt-6">
    <ul className="flex gap-2 overflow-x-auto pb-1">
      {chips.map((chip) => {
        const active = query[chip.key] === chip.value;
        return <li key={`${chip.key}-${chip.value}`} className="shrink-0">
          <Link
            href={chipHref(query, chip.key, chip.value)}
            aria-current={active ? 'true' : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? 'border-ink bg-ink text-white' : 'border-rule bg-white hover:bg-paper'}`}
          >{chip.label}</Link>
        </li>;
      })}
    </ul>
  </nav>;
}
