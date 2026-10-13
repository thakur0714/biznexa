import type { Metadata } from 'next';
import { CertificateDetailView } from './certificate-detail-view';

export const metadata: Metadata = { title: 'Certificate Detail' };

export default function CertificateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <CertificateDetailView params={params} />;
}
