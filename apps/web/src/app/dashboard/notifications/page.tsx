import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { NotificationsView } from './notifications-view';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false },
};

export default function NotificationsPage() {
  return (
    <Suspense>
      <RequireAuth>
        <NotificationsView />
      </RequireAuth>
    </Suspense>
  );
}
