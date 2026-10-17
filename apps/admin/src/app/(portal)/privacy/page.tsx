import { Metadata } from 'next';
import { PrivacyRequestsView } from './privacy-view';

export const metadata: Metadata = { title: 'Privacy requests' };

export default function Page() {
  return <PrivacyRequestsView />;
}
