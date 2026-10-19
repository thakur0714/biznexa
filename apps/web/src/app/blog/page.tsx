import type { Metadata } from 'next';
import { BlogListing } from './blog-listing';

export const metadata: Metadata = { title: 'Resources', description: 'Guides and updates on GST, tax, trademarks, compliance and certification for Indian businesses.', alternates: { canonical: '/blog' } };
export const revalidate = 300;

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  return <BlogListing title="Resources" page={page} />;
}
