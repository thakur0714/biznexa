import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceEditorView } from '../editor/service-editor';

export const metadata: Metadata = { title: 'Edit service' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <ServiceEditorView id={id} />;
}
