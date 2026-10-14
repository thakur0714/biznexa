import { Metadata } from 'next';
import { ApplicationsView } from './applications-view';

export const metadata: Metadata = { title: 'Applications' };

export default function Page() {
  return <ApplicationsView />;
}
