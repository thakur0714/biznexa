import { CustomerDetailView } from './customer-detail-view';

export default async function CustomerDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <CustomerDetailView id={id} />;
}
