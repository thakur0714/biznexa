'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { visibleNav } from '@/lib/nav';

/** Sections the signed-in user's permissions allow (see lib/nav.ts). */
export function SidebarNav({ permissions, roles = [], onNavigate }: { permissions: string[]; roles?: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = visibleNav(permissions, undefined, roles);

  return (
    <nav aria-label="Admin sections" className="space-y-6">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-white/50">{g.label}</p>
          <ul className="mt-2 space-y-0.5">
            {g.items.map((item) => {
              const href = `/${item.slug}`;
              const active = item.slug === '' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md px-3 py-2 text-[15px] transition-colors ${active ? 'bg-white/12 font-semibold text-white' : 'text-white/75 hover:bg-white/8 hover:text-white'}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
