import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { CustomerPaymentsView } from './payments-view';

export const metadata: Metadata = {
  title: 'Payments — BizNexa',
  robots: { index: false },
};

export default function CustomerPaymentsPage() {
  return (
    <Suspense>
      <RequireAuth>
        <CustomerPaymentsView />
      </RequireAuth>
    </Suspense>
  );
}
