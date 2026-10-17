import type { Metadata } from 'next';
import { ConsultantsReportView } from './consultants-view';

export const metadata: Metadata = { title: 'Consultants Report' };

export default function ConsultantsReportPage() {
  return <ConsultantsReportView />;
}
