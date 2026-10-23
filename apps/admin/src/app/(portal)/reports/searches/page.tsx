import type { Metadata } from 'next';
import { SearchesReportView } from './searches-view';

export const metadata: Metadata = { title: 'Searches Report' };

export default function SearchesReportPage() {
  return <SearchesReportView />;
}
