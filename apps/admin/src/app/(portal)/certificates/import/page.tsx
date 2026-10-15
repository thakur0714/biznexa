import type { Metadata } from 'next';
import { CertificateImportView } from './certificate-import-view';

export const metadata: Metadata = { title: 'Bulk Import Certificates' };

export default function CertificateImportPage() {
  return <CertificateImportView />;
}
