import type { Metadata } from 'next';
import { CertificateCreateView } from './certificate-create-view';

export const metadata: Metadata = { title: 'Issue Certificate' };

export default function CertificateCreatePage() {
  return <CertificateCreateView />;
}
