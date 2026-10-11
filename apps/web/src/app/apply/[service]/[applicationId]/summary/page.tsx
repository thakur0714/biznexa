import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { apiOrNull, type ServiceDetail } from '@/lib/api';
import { SummaryStep } from './summary-step';

export const metadata: Metadata = { title: 'Order summary', robots: { index: false } };

export default async function ApplySummaryPage({ params }: { params: Promise<{ service: string; applicationId: string }> }) {
  const { service, applicationId } = await params;
  const s = await apiOrNull<ServiceDetail>(`/catalogue/services/${encodeURIComponent(service)}`);
  if (!s) notFound();

  return (
    <Suspense>
      <RequireAuth>
        <SummaryStep service={s} applicationId={applicationId} />
      </RequireAuth>
    </Suspense>
  );
}
