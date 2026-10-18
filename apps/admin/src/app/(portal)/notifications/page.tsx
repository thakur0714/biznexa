import type { Metadata } from 'next';
import { NotificationsHub } from './notifications-hub';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return <NotificationsHub />;
}
