import { Metadata } from 'next';
import { DocumentsView } from './documents-view';

export const metadata: Metadata = { title: 'Document Review' };

export default function DocumentsPage() {
  return <DocumentsView />;
}
