'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { useAuth } from '@/lib/auth';
import { useApi } from '@biznexa/api-client/react';

export function NotificationBell() {
  const { user } = useAuth();
  const api = useApi();
  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    api
      .call<{ count: number }>((c) => c.GET('/api/notifications/unread-count'))
      .then((res) => {
        if (!cancelled && typeof res?.count === 'number') {
          setUnreadCount(res.count);
        }
      })
      .catch(() => {
        // Background refresh only; ignore failures on bell mount
      });

    return () => {
      cancelled = true;
    };
  }, [api, user]);

  if (!user) return null;

  return (
    <Link
      href="/dashboard/notifications"
      aria-label={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'Notifications'}
      className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-ink-050 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink transition-colors"
    >
      <Icon name="bell" size={20} />
      {unreadCount > 0 && (
        <span
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white"
          data-testid="unread-badge"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
