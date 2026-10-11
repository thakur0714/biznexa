import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { DashboardHome } from './dashboard-home';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

export default function DashboardPage() {
  return (
    <Suspense>
      <RequireAuth>
        <DashboardHome />
      </RequireAuth>
    </Suspense>
  );
}
