import type { Metadata } from 'next';
import { ApplicationDetailView } from './application-detail-view';

export const metadata: Metadata = {
  title: 'Application Details | Dashboard | BizNexa',
  robots: { index: false, follow: false },
};

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ApplicationDetailView applicationId={id} />;
}
