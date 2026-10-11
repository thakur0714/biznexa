import type { Metadata } from 'next';
import { CmsPage } from '@/components/cms-page';

export const revalidate = 300;
export const metadata: Metadata = { title: 'Privacy Policy', alternates: { canonical: '/privacy' } };

export default function Page() {
  return <CmsPage slug="privacy" />;
}
