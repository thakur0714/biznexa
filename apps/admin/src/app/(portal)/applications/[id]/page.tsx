import { Metadata } from 'next';
import { ApplicationDetailView } from './application-detail-view';

export const metadata: Metadata = { title: 'Application Details' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationDetailView id={id} />;
}
