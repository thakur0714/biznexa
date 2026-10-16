import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { CustomerBusinessesView } from './businesses-view';

export const metadata: Metadata = {
  title: 'My Businesses — BizNexa',
  robots: { index: false },
};

export default function CustomerBusinessesPage() {
  return (
    <Suspense>
      <RequireAuth>
        <CustomerBusinessesView />
      </RequireAuth>
    </Suspense>
  );
}
