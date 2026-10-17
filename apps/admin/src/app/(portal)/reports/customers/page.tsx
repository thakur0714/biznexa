import type { Metadata } from 'next';
import { CustomersReportView } from './customers-report-view';

export const metadata: Metadata = { title: 'Customers Report' };

export default function CustomersReportPage() {
  return <CustomersReportView />;
}
