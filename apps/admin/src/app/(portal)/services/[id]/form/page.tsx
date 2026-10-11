import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FormBuilderView } from '../../form-builder/form-builder';

export const metadata: Metadata = { title: 'Application form' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ServiceFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <FormBuilderView serviceId={id} />;
}
