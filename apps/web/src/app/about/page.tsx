import type { Metadata } from 'next';
import { CmsPage, cmsMetadata } from '@/components/cms-page';

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> { return { ...await cmsMetadata('about'), alternates: { canonical: '/about' } }; }

export default function AboutPage() { return <CmsPage slug="about" />; }
