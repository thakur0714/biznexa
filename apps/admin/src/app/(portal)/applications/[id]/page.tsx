import { Metadata } from 'next';
import { ApplicationDetailView } from './application-detail-view';

export const metadata: Metadata = { title: 'Application Details' };

export default function Page({ params }: { params: { id: string } }) {
  return <ApplicationDetailView id={params.id} />;
}
