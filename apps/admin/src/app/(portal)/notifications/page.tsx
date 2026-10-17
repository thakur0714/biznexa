import { Metadata } from 'next';
import { DeliveriesView } from './deliveries-view';

export const metadata: Metadata = { title: 'Notification log' };

export default function Page() {
  return <DeliveriesView />;
}
