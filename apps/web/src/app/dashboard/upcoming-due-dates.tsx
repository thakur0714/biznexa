'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { EmptyState, Notice } from '@biznexa/ui';
import { formatDate, istDay, type ReminderListResponse, type ServiceCategoryLookup } from '@biznexa/types';

function daysLeft(dueDate: string): number {
  const calendarDay = (value: string) => {
    const [year, month, day] = istDay(value).split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.max(0, Math.round((calendarDay(dueDate) - calendarDay(new Date().toISOString())) / 86_400_000));
}

export function UpcomingDueDates() {
  const api = useApi();
  const [items, setItems] = useState<ReminderListResponse['items'] | null>(null);
  const [categorySlugs, setCategorySlugs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [renewLookupError, setRenewLookupError] = useState(false);

  useEffect(() => {
    let live = true;

    void api.call<ReminderListResponse>((client) => client.GET('/api/reminders'))
      .then(async (response) => {
        if (!live) return;
        const upcoming = response.items.slice(0, 5);
        setItems(upcoming);

        const serviceSlugs = [...new Set(upcoming.flatMap((reminder) => reminder.renewServiceSlug ? [reminder.renewServiceSlug] : []))];
        const lookups = await Promise.all(serviceSlugs.map(async (serviceSlug) => {
          try {
            const result = await api.call<ServiceCategoryLookup>((client) =>
              client.GET('/api/catalogue/services/{slug}', { params: { path: { slug: serviceSlug } } }),
            );
            return { serviceSlug, categorySlug: result.category.slug };
          } catch {
            return null;
          }
        }));

        if (live) {
          setCategorySlugs(Object.fromEntries(lookups.filter((lookup) => lookup !== null).map(({ serviceSlug, categorySlug }) => [serviceSlug, categorySlug])));
          setRenewLookupError(lookups.includes(null));
        }
      })
      .catch(() => {
        if (live) {
          setItems([]);
          setError('We couldn’t load your upcoming due dates. Please try again.');
        }
      });

    return () => { live = false; };
  }, [api]);

  let dueDateContent: React.ReactNode;
  if (items === null) {
    dueDateContent = <p role="status" className="text-sm text-muted">Loading upcoming due dates…</p>;
  } else if (items.length === 0) {
    dueDateContent = <EmptyState className="p-6" titleAs="h3" title="No upcoming due dates" description="Scheduled reminders will appear here." />;
  } else {
    dueDateContent = (
      <ul className="space-y-3">
        {items.map((reminder) => {
          const categorySlug = reminder.renewServiceSlug ? categorySlugs[reminder.renewServiceSlug] : undefined;
          const remainingDays = daysLeft(reminder.dueDate);
          return (
            <li key={reminder.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-white p-4 sm:p-5">
              <div className="min-w-0">
                <h3 className="font-semibold">{reminder.title}</h3>
                <p className="mt-1 text-sm text-muted">Due {formatDate(reminder.dueDate)} · {remainingDays} {remainingDays === 1 ? 'day' : 'days'} left</p>
              </div>
              {reminder.renewServiceSlug && categorySlug && (
                <Link href={`/services/${encodeURIComponent(categorySlug)}/${encodeURIComponent(reminder.renewServiceSlug)}`} className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-semibold text-ink underline underline-offset-4 hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Renew</Link>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="upcoming-due-dates-heading" className="space-y-3">
      <h2 id="upcoming-due-dates-heading" className="text-xl font-semibold">Upcoming due dates</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {renewLookupError && <Notice tone="error">A renewal link couldn’t be loaded. Please try again later.</Notice>}
      {dueDateContent}
    </section>
  );
}
