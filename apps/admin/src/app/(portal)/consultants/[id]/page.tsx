import { Metadata } from 'next';
import { ConsultantDetailView } from './consultant-detail-view';

export const metadata: Metadata = { title: 'Consultant review' };

export default function Page({ params }: { params: { id: string } }) {
  return <ConsultantDetailView id={params.id} />;
}
