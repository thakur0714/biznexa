import type { Metadata } from 'next';
import { ServiceEditorView } from '../editor/service-editor';

export const metadata: Metadata = { title: 'New service' };

export default function NewServicePage() {
  return <ServiceEditorView />;
}
