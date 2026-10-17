'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ReportsNav() {
  const pathname = usePathname();

  const tabs = [
    { label: 'Sales', href: '/reports/sales' },
    { label: 'Customers', href: '/reports/customers' },
    { label: 'Services', href: '/reports/services' },
    { label: 'Consultants', href: '/reports/consultants' },
  ];



  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-night">Reports</h1>
        <p className="mt-1 text-sm text-muted">
          Aggregated analytics, revenue performance, and customer growth trends.
        </p>
      </div>

      <nav className="flex space-x-2 border-b border-rule">
        {tabs.map((tab) => {
          const active = pathname === tab.href || (tab.href === '/reports/sales' && pathname === '/reports');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`border-b-2 px-3 pb-2 text-sm font-semibold transition-colors ${
                active
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:border-rule hover:text-night'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
