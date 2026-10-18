import type { Metadata } from 'next';
import { CmsPage, cmsMetadata } from '@/components/cms-page';

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> { return { ...await cmsMetadata('refund-policy'), alternates: { canonical: '/refund-policy' } }; }

export default function Page() {
  return <CmsPage slug="refund-policy" />;
}
