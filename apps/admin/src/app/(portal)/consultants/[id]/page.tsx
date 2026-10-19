import { Metadata } from 'next';
import { ConsultantDetailView } from './consultant-detail-view';

export const metadata: Metadata = { title: 'Consultant review' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConsultantDetailView id={id} />;
}
