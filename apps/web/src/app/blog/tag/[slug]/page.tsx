import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { PublicBlogTaxonomy } from '@biznexa/types';
import { BlogListing } from '../../blog-listing';

export const revalidate = 300;
export async function generateMetadata({ params }: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  try { const tags = await api<PublicBlogTaxonomy[]>('/public/blog/tags', { revalidate: 300 }); const tag = tags.find((entry) => entry.slug === slug); return tag ? { title: `${tag.name} articles`, alternates: { canonical: `/blog/tag/${slug}` } } : {}; } catch { return {}; }
}
export default async function BlogTagPage({ params, searchParams }: Readonly<{ params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }>) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  let tag: PublicBlogTaxonomy | undefined;
  try {
    const tags = await api<PublicBlogTaxonomy[]>('/public/blog/tags', { revalidate: 300 });
    tag = tags.find((entry) => entry.slug === slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
  if (!tag) notFound();
  return <BlogListing tag={slug} title={tag.name} page={Math.max(1, Number(search.page) || 1)} />;
}
