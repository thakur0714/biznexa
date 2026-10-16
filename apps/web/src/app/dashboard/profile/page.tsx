import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { CustomerProfileView } from './profile-view';

export const metadata: Metadata = {
  title: 'Profile & Settings — BizNexa',
  robots: { index: false },
};

export default function CustomerProfilePage() {
  return (
    <Suspense>
      <RequireAuth>
        <CustomerProfileView />
      </RequireAuth>
    </Suspense>
  );
}
