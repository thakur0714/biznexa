import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { CustomerCertificatesView } from './certificates-view';

export const metadata: Metadata = {
  title: 'My Certificates — BizNexa',
  robots: { index: false },
};

export default function CustomerCertificatesPage() {
  return (
    <Suspense>
      <RequireAuth>
        <CustomerCertificatesView />
      </RequireAuth>
    </Suspense>
  );
}
