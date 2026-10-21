'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { needsTwoFactor } from '@biznexa/types';
import { useAuth } from '@/lib/auth';
import { Logo } from '@biznexa/ui';
import { SidebarNav } from './sidebar';
import { Button } from '@biznexa/ui';

/**
 * Protected frame for every portal page: sends visitors without a staff session to /login and
 * sessions that still need 2FA to /two-factor, then renders the permission-driven sidebar (a drawer below the lg breakpoint).
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const { user, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const pendingTwoFactor = needsTwoFactor(user?.twoFactor);
  const consultantOnly = user?.roles.includes('CONSULTANT') ?? false;
  const consultantRoutes = ['/consultant/profile', '/consultant/availability', '/consultant/bookings', '/consultant/applications', '/consultant/messages', '/consultant/earnings', '/applications/'];
  const outsideConsultantPortal = consultantOnly && !consultantRoutes.some((route) => pathname === route || (route.endsWith('/') && pathname.startsWith(route)));

  useEffect(() => {
    if (ready && user && !pendingTwoFactor && outsideConsultantPortal) {
      router.replace('/consultant/bookings');
      return;
    }
    if (!ready || (user && !pendingTwoFactor)) return;
    const here = sp.toString() ? `${pathname}?${sp}` : pathname;
    const to = user ? '/two-factor' : '/login';
    router.replace(here === '/' ? to : `${to}?next=${encodeURIComponent(here)}`);
  }, [ready, user, pendingTwoFactor, outsideConsultantPortal, router, pathname, sp]);

  const close = useCallback(() => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => node.offsetParent !== null || node.getClientRects().length > 0,
    );
    if (focusables[0]) {
      focusables[0].focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const elements = Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node.getClientRects().length > 0,
      );
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (!active || !sidebar.contains(active) || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!active || !sidebar.contains(active) || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, close]);

  if (!ready || !user || pendingTwoFactor || outsideConsultantPortal) {
    return (
      <div className="px-6 py-24 text-center text-muted" role="status">
        Checking your session…
      </div>
    );
  }

  async function logout() {
    await signOut();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-rule bg-white px-4 lg:hidden">
        <Logo tag={consultantOnly ? 'Consultant' : 'Admin'} />
        <Button ref={triggerRef} variant="outline" size="sm" aria-expanded={menuOpen} aria-controls="admin-sidebar" onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? 'Close' : 'Menu'}
        </Button>
      </header>

      {menuOpen && <div className="fixed inset-0 z-30 bg-night/40 lg:hidden" aria-hidden="true" onClick={close} />}

      <aside
        ref={sidebarRef}
        id="admin-sidebar"
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen ? 'true' : undefined}
        aria-label={consultantOnly ? 'Consultant navigation' : 'Admin navigation'}
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-ink text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${menuOpen ? 'translate-x-0' : 'invisible -translate-x-full lg:visible'}`}
      >
        <div className="hidden h-16 items-center px-5 lg:flex">
          <Logo inverted tag={consultantOnly ? 'Consultant' : 'Admin'} />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-4 lg:py-2">
          <SidebarNav permissions={user.permissions} roles={user.roles} onNavigate={close} />
        </div>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-white/60">{user.email ?? user.mobile}</p>
          <button type="button" onClick={logout} className="mt-3 text-sm font-medium text-marigold hover:underline">
            Log out
          </button>
        </div>
      </aside>

      <main id="main" className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </div>
  );
}

/** Shown when a signed-in staff member opens a section their role does not include. */
export function NotAllowed() {
  return (
    <div className="max-w-[560px] rounded-lg border border-rule bg-white p-6" role="alert">
      <h1 className="text-xl font-bold">You’re not allowed to view this section</h1>
      <p className="mt-2 text-muted">Your role doesn’t include access to this part of the portal. Ask an admin if you need it.</p>
    </div>
  );
}
