import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { apiOrNull, type ServiceDetail } from '@/lib/api';
import { ApplySummary } from './apply-summary';

export const metadata: Metadata = { title: 'Start your application', robots: { index: false } };

export default async function ApplyPage({ params, searchParams }: { params: Promise<{ service: string }>; searchParams: Promise<{ package?: string }> }) {
  const { service } = await params;
  const { package: pkgId } = await searchParams;
  const s = await apiOrNull<ServiceDetail>(`/catalogue/services/${encodeURIComponent(service)}`);
  if (!s) notFound();
  const pkg = s.packages.find((p) => p.id === pkgId) ?? s.packages.find((p) => p.isMostPopular) ?? s.packages[0];

  return (
    <Suspense>
      <RequireAuth>
        <ApplySummary service={s} pkg={pkg} />
      </RequireAuth>
    </Suspense>
  );
}
