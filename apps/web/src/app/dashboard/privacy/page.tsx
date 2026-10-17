import type { Metadata } from 'next';
import { PrivacyView } from './privacy-view';

export const metadata: Metadata = {
  title: 'Privacy & your data — BizNexa',
  robots: { index: false },
};

export default function CustomerPrivacyPage() {
  return <PrivacyView />;
}
