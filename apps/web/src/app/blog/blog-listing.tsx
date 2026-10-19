import Link from 'next/link';
import { Container } from '@biznexa/ui';
import { api, ApiError } from '@/lib/api';
import { BlogPostCard } from '@/components/blog-post-card';
import type { PublicBlogPagedList, PublicBlogTaxonomy } from '@biznexa/types';

const blogDataRevalidate = process.env.NODE_ENV === 'development' ? 0 : 300;

export async function BlogListing({ category, tag, title, page = 1 }: { category?: string; tag?: string; title: string; page?: number }) {
  let data: { list: PublicBlogPagedList; categories: PublicBlogTaxonomy[]; tags: PublicBlogTaxonomy[] } | null = null;
  try {
    const query = new URLSearchParams({ page: String(page), pageSize: '12', ...(category ? { category } : {}), ...(tag ? { tag } : {}) });
    const [list, categories, tags] = await Promise.all([
      api<PublicBlogPagedList>(`/public/blog/posts?${query}`, { revalidate: blogDataRevalidate }),
      api<PublicBlogTaxonomy[]>('/public/blog/categories', { revalidate: 3600 }),
      api<PublicBlogTaxonomy[]>('/public/blog/tags', { revalidate: 3600 }),
    ]);
    data = { list, categories, tags };
  } catch (error) {
    if ((category || tag) && error instanceof ApiError && error.status === 404) throw error;
    if (process.env.NODE_ENV === 'development') console.error('Public blog listing failed to load', error);
  }
  if (!data) return <Container className="py-16"><h1 className="text-4xl font-bold">{title}</h1><p role="alert" className="mt-6 rounded-lg border border-rule p-6 text-muted">Articles are temporarily unavailable. Please try again shortly.</p></Container>;
  const { list, categories, tags } = data;
  return <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl text-center"><h1 className="text-4xl font-bold tracking-tight">{title}</h1><p className="mt-3 text-lg text-muted">Guides and updates for Indian businesses.</p></div>
      <nav aria-label="Blog categories" className="mt-8 flex flex-wrap justify-center gap-2">
        <Link href="/blog" className={`rounded-full border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink ${!category ? 'border-ink bg-ink text-white' : 'border-rule bg-white'}`}>All articles</Link>
        {categories.map((item) => <Link key={item.id} href={`/blog/category/${item.slug}`} className="rounded-full border border-rule bg-white px-4 py-2 text-sm hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">{item.name} <span className="text-muted">{item.postCount}</span></Link>)}
      </nav>
      {tag && tags.some((item) => item.slug === tag) && <p className="mt-5 text-center text-sm text-muted">Tagged “{tags.find((item) => item.slug === tag)?.name}”</p>}
      {list.items.length ? <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{list.items.map((post) => <BlogPostCard key={post.slug} post={post} />)}</div> : <p className="mt-12 rounded-lg border border-dashed border-rule p-8 text-center text-muted">No articles here yet. Check back soon.</p>}
      {list.pages > 1 && <nav aria-label="Blog pages" className="mt-10 flex items-center justify-center gap-3">{list.page > 1 && <Link className="rounded border border-rule px-4 py-2 text-sm hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink" href={`${category ? `/blog/category/${category}` : tag ? `/blog/tag/${tag}` : '/blog'}?page=${list.page - 1}`}>Previous page</Link>}<span className="rounded border border-rule px-4 py-2 text-sm" aria-current="page">Page {list.page} of {list.pages}</span>{list.page < list.pages && <Link className="rounded border border-rule px-4 py-2 text-sm hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink" href={`${category ? `/blog/category/${category}` : tag ? `/blog/tag/${tag}` : '/blog'}?page=${list.page + 1}`}>Next page</Link>}</nav>}
  </Container>;
}
