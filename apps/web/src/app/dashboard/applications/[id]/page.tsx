import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ApplicationDetailView } from './application-detail-view';

export const metadata: Metadata = {
  title: 'Application Details | Dashboard | BizNexa',
  robots: { index: false, follow: false },
};

export default async function ApplicationDetailPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-rule bg-white p-10 text-center text-sm text-muted" role="status">
          Loading application details…
        </div>
      }
    >
      <ApplicationDetailView applicationId={id} />
    </Suspense>
  );
}
