import type { Metadata } from 'next';
import { ServicesReportView } from './services-view';

export const metadata: Metadata = { title: 'Services Report' };

export default function ServicesReportPage() {
  return <ServicesReportView />;
}
