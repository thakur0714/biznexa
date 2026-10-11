import type { Metadata } from 'next';
import { CmsPage } from '@/components/cms-page';

export const revalidate = 300;
export const metadata: Metadata = { title: 'Terms & Conditions', alternates: { canonical: '/terms' } };

export default function Page() {
  return <CmsPage slug="terms" />;
}
