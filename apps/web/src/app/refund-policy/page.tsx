import type { Metadata } from 'next';
import { CmsPage } from '@/components/cms-page';

export const revalidate = 300;
export const metadata: Metadata = { title: 'Refund Policy', alternates: { canonical: '/refund-policy' } };

export default function Page() {
  return <CmsPage slug="refund-policy" />;
}
