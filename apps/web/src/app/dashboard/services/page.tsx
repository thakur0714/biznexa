import type { Metadata } from 'next';
import { MyServicesView } from './services-view';

export const metadata: Metadata = {
  title: 'My Services',
  robots: { index: false },
};

export default function MyServicesPage() {
  return <MyServicesView />;
}
