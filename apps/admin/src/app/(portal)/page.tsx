'use client';

import Link from 'next/link';
import { EmptyState } from '@biznexa/ui';
import { useAuth } from '@/lib/auth';
import { visibleNav } from '@/lib/nav';

/** Landing page: who you are and the sections your role can open. KPI cards arrive with the reports milestone. */
export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const sections = visibleNav(user.permissions)
    .flatMap((g) => g.items)
    .filter((i) => i.slug !== '');

  return (
    <div className="max-w-[960px]">
      <h1 className="text-2xl font-bold tracking-[-0.02em]">Welcome, {user.name.split(' ')[0]}</h1>
      <p className="mt-1 text-muted">Signed in as {user.roles.map((r) => r.charAt(0) + r.slice(1).toLowerCase()).join(', ')}.</p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Your sections</h2>
      {sections.length === 0 ? (
        <EmptyState className="mt-3" title="No sections yet" description="No sections are assigned to your role yet. Ask an admin to grant access." />
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <li key={s.slug}>
              <Link href={`/${s.slug}`} className="block rounded-lg border border-rule bg-white p-4 font-medium transition-colors hover:border-ink">
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
