import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { PublicBlogTaxonomy } from '@biznexa/types';
import { BlogListing } from '../../blog-listing';

export const revalidate = 300;
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try { const categories = await api<PublicBlogTaxonomy[]>('/public/blog/categories', { revalidate: 300 }); const category = categories.find((entry) => entry.slug === slug); return category ? { title: `${category.name} articles`, alternates: { canonical: `/blog/category/${slug}` } } : {}; } catch { return {}; }
}
export default async function BlogCategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  let category: PublicBlogTaxonomy | undefined;
  try {
    const categories = await api<PublicBlogTaxonomy[]>('/public/blog/categories', { revalidate: 300 });
    category = categories.find((entry) => entry.slug === slug);
  } catch (error) { if (error instanceof ApiError && error.status === 404) notFound(); throw error; }
  if (!category) notFound();
  return <BlogListing category={slug} title={category.name} page={Math.max(1, Number(search.page) || 1)} />;
}
