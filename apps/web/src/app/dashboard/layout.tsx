'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Button } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/components/notification-bell';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth';

interface NavSection {
  readonly label: string;
  readonly icon: string;
  readonly href?: string;
  readonly ready: boolean;
}

/** Customer portal sections (PRD §7.3, M5.1). Pages not yet built show "Soon". */
export const DASHBOARD_NAV: readonly NavSection[] = [
  { label: 'Dashboard', icon: 'clipboard', href: '/dashboard', ready: true },
  { label: 'My Services', icon: 'file', href: '/dashboard/services', ready: true },
  { label: 'Documents', icon: 'upload', href: '/dashboard/documents', ready: true },
  { label: 'Payments', icon: 'rupee', ready: false },
  { label: 'Messages', icon: 'message', ready: false },
  { label: 'Certificates', icon: 'badge', href: '/dashboard/certificates', ready: true },
  { label: 'Notifications', icon: 'bell', href: '/dashboard/notifications', ready: true },
  { label: 'Profile', icon: 'people', ready: false },
  { label: 'Businesses', icon: 'building', ready: false },
  { label: 'Support', icon: 'phone', ready: false },
];

function isSectionActive(href: string, pathname: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  if (href === '/dashboard/services') {
    return (
      pathname === '/dashboard/services' ||
      pathname.startsWith('/dashboard/services/') ||
      pathname.startsWith('/dashboard/applications/')
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const api = useApi();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const refreshUnreadCount = useCallback(() => {
    if (!user) return;
    let cancelled = false;
    api
      .call<{ count: number }>((c) => c.GET('/api/notifications/unread-count'))
      .then((res) => {
        if (!cancelled) setUnreadNotifications(res.count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, user]);

  useEffect(() => {
    return refreshUnreadCount();
  }, [refreshUnreadCount, pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChanged = () => {
      refreshUnreadCount();
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
  }, [refreshUnreadCount]);

  const currentSection =
    DASHBOARD_NAV.find((n) => n.href && isSectionActive(n.href, pathname))?.label ?? 'Dashboard';

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:py-10">
      {/* Mobile drawer bar */}
      <div className="mb-6 flex items-center justify-between border-b border-rule pb-4 lg:hidden">
        <span className="text-sm font-semibold text-night">{currentSection}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={drawerOpen}
          aria-controls="dashboard-sidebar"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <Icon name={drawerOpen ? 'x' : 'menu'} size={18} />
          <span>{drawerOpen ? 'Close' : 'Menu'}</span>
        </Button>
      </div>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-night/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[230px_1fr]">
        <aside
          id="dashboard-sidebar"
          className={`fixed inset-y-0 left-0 z-40 w-[260px] overflow-y-auto border-r border-rule bg-white p-4 transition-transform lg:static lg:z-auto lg:w-auto lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:translate-x-0 ${
            drawerOpen ? 'translate-x-0' : 'invisible -translate-x-full lg:visible'
          }`}
        >
          <div className="mb-4 flex items-center justify-between border-b border-rule pb-3 lg:hidden">
            <span className="text-sm font-semibold text-night">My Account</span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-md p-1 text-muted hover:text-night"
              aria-label="Close dashboard menu"
            >
              <Icon name="x" size={20} />
            </button>
          </div>

          <nav aria-label="Account" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <ul className="flex flex-col gap-1">
              {DASHBOARD_NAV.map((n) => {
                const active = Boolean(n.href && n.ready && isSectionActive(n.href, pathname));
                const showUnread = n.label === 'Notifications' && unreadNotifications > 0;

                return (
                  <li key={n.label}>
                    {n.href && n.ready ? (
                      <Link
                        href={n.href}
                        onClick={() => setDrawerOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          active ? 'bg-ink text-white' : 'text-night hover:bg-paper'
                        }`}
                      >
                        <Icon name={n.icon} size={18} />
                        <span>{n.label}</span>
                        {showUnread && (
                          <span
                            data-testid="sidebar-notifications-unread"
                            className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                              active ? 'bg-white text-ink' : 'bg-danger text-white'
                            }`}
                          >
                            {unreadNotifications > 99 ? '99+' : unreadNotifications}
                          </span>
                        )}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted"
                      >
                        <Icon name={n.icon} size={18} />
                        <span>{n.label}</span>
                        <span className="ml-auto rounded bg-paper px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-rule">
                          Soon
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <RequireAuth>
        <DashboardShell>{children}</DashboardShell>
      </RequireAuth>
    </Suspense>
  );
}
