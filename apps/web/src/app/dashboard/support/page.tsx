import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { CustomerSupportView } from './support-view';

export const metadata: Metadata = {
  title: 'Support — BizNexa',
  robots: { index: false },
};

export default function CustomerSupportPage() {
  return (
    <Suspense>
      <RequireAuth>
        <CustomerSupportView />
      </RequireAuth>
    </Suspense>
  );
}
