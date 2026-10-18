import type { Metadata } from 'next';
import { CmsPage, cmsMetadata } from '@/components/cms-page';

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> { return { ...await cmsMetadata('privacy'), alternates: { canonical: '/privacy' } }; }

export default function Page() {
  return <CmsPage slug="privacy" />;
}
