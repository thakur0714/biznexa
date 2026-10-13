import type { Metadata } from 'next';
import { CertificationBodiesView } from './bodies-view';

export const metadata: Metadata = { title: 'Certification Bodies' };

export default function CertificationBodiesPage() {
  return <CertificationBodiesView />;
}
