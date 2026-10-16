import { CustomerDetailView } from './customer-detail-view';

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  return <CustomerDetailView id={params.id} />;
}
