import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { apiOrNull, type ServiceDetail } from '@/lib/api';
import { ApplyForm } from './apply-form';

export const metadata: Metadata = { title: 'Your details', robots: { index: false } };

export default async function ApplyFormPage({ params }: Readonly<{ params: Promise<{ service: string; applicationId: string }> }>) {
  const { service, applicationId } = await params;
  const s = await apiOrNull<ServiceDetail>(`/catalogue/services/${encodeURIComponent(service)}`);
  if (!s) notFound();

  return (
    <Suspense>
      <RequireAuth>
        <ApplyForm service={s} applicationId={applicationId} />
      </RequireAuth>
    </Suspense>
  );
}
