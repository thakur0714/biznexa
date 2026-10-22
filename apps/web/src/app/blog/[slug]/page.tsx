import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@biznexa/ui';
import { formatDate, type PublicBlogPagedList, type PublicBlogPostDetail } from '@biznexa/types';
import { api, ApiError } from '@/lib/api';
import { RichText } from '@/components/rich-text';
import { BlogPostCard } from '@/components/blog-post-card';

export const revalidate = 300;
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const blogDataRevalidate = process.env.NODE_ENV === 'development' ? 0 : 300;

function resolveImageUrl(img?: string | null): string | undefined {
  if (!img) return undefined;
  return img.startsWith('http') ? img : `${site()}${img}`;
}

async function getPost(slug: string): Promise<PublicBlogPostDetail | null> {
  try {
    return await api<PublicBlogPostDetail>(`/public/blog/posts/${encodeURIComponent(slug)}`, { revalidate: blogDataRevalidate });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  const title = post.seoTitle || post.title;
  const description = post.metaDescription || post.excerpt || `Read ${post.title} on BizNexa.`;
  const canonical = `/blog/${post.slug}`;
  const image = resolveImageUrl(post.featuredImage);
  return { title, description, alternates: { canonical }, openGraph: { type: 'article', title, description, url: canonical, publishedTime: post.publishedAt, authors: post.authorName ? [post.authorName] : undefined, images: image ? [{ url: image }] : undefined } };
}

export default async function BlogPostPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();
  const query = new URLSearchParams({ page: '1', pageSize: '4', ...(post.categories[0] ? { category: post.categories[0].slug } : {}) });
  const related = await api<PublicBlogPagedList>(`/public/blog/posts?${query}`, { revalidate: blogDataRevalidate }).then((list) => list.items.filter((item) => item.slug !== post.slug).slice(0, 3)).catch(() => []);
  const latest = related.length ? related : await api<PublicBlogPagedList>('/public/blog/posts?page=1&pageSize=4', { revalidate: blogDataRevalidate }).then((list) => list.items.filter((item) => item.slug !== post.slug).slice(0, 3)).catch(() => []);
  const canonical = `${site()}/blog/${post.slug}`;
  const article = { '@context': 'https://schema.org', '@type': 'Article', headline: post.title, description: post.metaDescription || post.excerpt || undefined, image: resolveImageUrl(post.featuredImage), datePublished: post.publishedAt, author: { '@type': 'Person', name: post.authorName || 'BizNexa' }, publisher: { '@type': 'Organization', name: 'BizNexa' }, mainEntityOfPage: canonical };
  return <>
    <article>
      <Container className="max-w-3xl py-10 sm:py-16">
        <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/blog" className="rounded underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">Resources</Link>{post.categories.map((category) => <span key={category.id}> / <Link href={`/blog/category/${category.slug}`} className="rounded underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">{category.name}</Link></span>)}</nav>
        <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{post.title}</h1>
        {post.excerpt && <p className="mt-5 text-xl leading-8 text-muted">{post.excerpt}</p>}
        <p className="mt-5 text-sm text-muted">{post.authorName && <>{post.authorName} · </>}<time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time></p>
        {post.featuredImage && (
          // eslint-disable-next-line @next/next/no-img-element -- CMS/upload image, unknown host and size
          <img src={post.featuredImage} alt="" className="mt-8 max-h-[520px] w-full rounded-xl object-cover" />
        )}
        <RichText html={post.content} className="mt-10" />
        {post.tags.length > 0 && <nav aria-label="Article tags" className="mt-10 flex flex-wrap gap-2">{post.tags.map((tag) => <Link key={tag.id} href={`/blog/tag/${tag.slug}`} className="rounded-full border border-rule px-3 py-1.5 text-sm hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">{tag.name}</Link>)}</nav>}
      </Container>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(article).replaceAll('<', String.raw`\u003c`) }} />
    </article>
    {latest.length > 0 && <section aria-labelledby="related-posts" className="border-t border-rule bg-white"><Container className="py-12"><h2 id="related-posts" className="text-2xl font-bold">{related.length ? 'Related articles' : 'Latest articles'}</h2><div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{latest.map((item) => <BlogPostCard key={item.slug} post={item} />)}</div></Container></section>}
  </>;
}
