import type { Metadata } from 'next';
import { SalesReportView } from './sales-view';

export const metadata: Metadata = { title: 'Sales Report' };

export default function SalesReportPage() {
  return <SalesReportView />;
}
