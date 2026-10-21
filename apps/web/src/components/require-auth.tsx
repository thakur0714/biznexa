'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

/** Sends visitors to /login (and back here afterwards) when there is no session. */
export function RequireAuth({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  useEffect(() => {
    if (ready && !user) {
      const here = sp.toString() ? `${pathname}?${sp}` : pathname;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [ready, user, router, pathname, sp]);

  if (!ready || !user) {
    return (
      <div className="mx-auto max-w-[1180px] px-6 py-24 text-center text-muted" role="status">
        Loading your account…
      </div>
    );
  }
  return <>{children}</>;
}
