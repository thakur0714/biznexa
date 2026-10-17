import { Metadata } from 'next';
import { ConsultantsView } from './consultants-view';

export const metadata: Metadata = { title: 'Consultants' };

export default function Page() {
  return <ConsultantsView />;
}
