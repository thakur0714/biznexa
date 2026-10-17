import type { Metadata } from 'next';
import { SupportReportView } from './support-view';

export const metadata: Metadata = { title: 'Support Report' };

export default function SupportReportPage() {
  return <SupportReportView />;
}
