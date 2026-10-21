'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { buttonClass, Logo } from '@biznexa/ui';
import { Icon } from './icons';
import { useAuth } from '@/lib/auth';
import type { CategorySummary } from '@/lib/api';
import { NotificationBell } from './notification-bell';

const NAV = [
  { href: '/consultants', label: 'Consultations' },
  { href: '/blog', label: 'Resources' },
  { href: '/verify', label: 'Verify Certificate' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function SiteHeader({ categories }: { readonly categories: readonly CategorySummary[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { user, ready } = useAuth();

  // Close both menus on navigation (state adjusted during render, not in an effect).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!menuOpen && !mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setMobileOpen(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen, mobileOpen]);

  let account: React.ReactNode = <span className="h-9 w-40" />;
  if (ready) {
    if (user) {
      account = (
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Link href="/dashboard" className={buttonClass('outline', 'sm')}>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[11px] font-semibold text-white">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span>My account</span>
          </Link>
        </div>
      );
    } else {
      account = (
        <>
          <Link href="/login" className={buttonClass('ghost', 'sm')}>
            Log in
          </Link>
          <Link href="/register" className={buttonClass('ink', 'sm')}>
            Sign up
          </Link>
        </>
      );
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-white/95 backdrop-blur">
      <div ref={wrapRef} className="relative mx-auto flex h-16 max-w-[1180px] items-center gap-6 px-4 sm:px-6">
        <Logo />

        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 lg:flex">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="services-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className={`flex items-center gap-1 rounded-md px-3 py-2 text-[15px] font-medium hover:bg-ink-050 ${menuOpen ? 'bg-ink-050 text-ink' : ''}`}
          >
            Services <Icon name="chevronDown" size={16} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>
          {menuOpen && (
            <div id="services-menu" className="absolute inset-x-4 top-[calc(100%+1px)] z-50 rounded-b-lg border border-t-0 border-rule bg-white p-6 shadow-[0_24px_40px_-20px_rgba(18,26,69,0.35)] sm:inset-x-6">
              <div className="grid grid-cols-4 gap-x-8 gap-y-6">
                {categories.map((c) => (
                  <div key={c.slug}>
                    <Link href={`/services/${c.slug}`} className="flex items-center gap-2 font-semibold text-night hover:text-ink">
                      <Icon name={c.icon ?? 'file'} size={18} className="text-ink" />
                      {c.name}
                    </Link>
                    <ul className="mt-2 space-y-1.5 border-l border-rule pl-[26px] text-sm text-muted">
                      {c.topServices.slice(0, 5).map((s) => (
                        <li key={s.slug}>
                          <Link href={`/services/${c.slug}/${s.slug}`} className="hover:text-ink hover:underline">
                            {s.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="flex flex-col justify-end rounded-md bg-ink-050 p-4">
                  <p className="text-sm text-muted">Browse every service with prices and timelines.</p>
                  <Link href="/services" className="mt-2 font-semibold text-ink hover:underline">
                    All services
                  </Link>
                </div>
              </div>
            </div>
          )}
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={pathname.startsWith(n.href) ? 'page' : undefined}
              className="rounded-md px-3 py-2 text-[15px] font-medium hover:bg-ink-050 aria-[current=page]:text-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">{account}</div>

        <div className="ml-auto flex items-center gap-1 lg:hidden">
          {ready && user && <NotificationBell />}
          <button type="button" className="rounded-md p-2" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} onClick={() => setMobileOpen((v) => !v)}>
            <Icon name={mobileOpen ? 'x' : 'menu'} size={24} />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-rule bg-white px-4 pb-6 pt-2 lg:hidden">
          <p className="px-2 pb-1 pt-3 text-sm font-semibold text-muted">Services</p>
          <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/services/${c.slug}`} className="flex items-center gap-2.5 rounded-md px-2 py-2.5 font-medium hover:bg-ink-050">
                  <Icon name={c.icon ?? 'file'} size={18} className="text-ink" />
                  {c.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/services" className="block rounded-md px-2 py-2.5 font-medium text-ink hover:bg-ink-050">
                All services
              </Link>
            </li>
          </ul>
          <div className="my-3 border-t border-rule" />
          <ul>
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="block rounded-md px-2 py-2.5 font-medium hover:bg-ink-050">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">{account}</div>
        </div>
      )}
    </header>
  );
}
