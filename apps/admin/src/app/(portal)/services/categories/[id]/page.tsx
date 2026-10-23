import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CategoryEditorView } from './category-editor';

export const metadata: Metadata = { title: 'Edit category' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditCategoryPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <CategoryEditorView id={id} />;
}
