import Link from 'next/link';
import { formatDate, type PublicBlogPost } from '@biznexa/types';

export function BlogPostCard({ post }: Readonly<{ post: PublicBlogPost }>) {
  return <article className="overflow-hidden rounded-xl border border-rule bg-white">
    <Link href={`/blog/${post.slug}`} className="group block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
      {post.featuredImage && (
        // eslint-disable-next-line @next/next/no-img-element -- CMS/upload image, unknown host and size
        <img src={post.featuredImage} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />
      )}
      <div className="p-5">
        {post.categories.length > 0 && <p className="text-xs font-semibold uppercase tracking-wide text-ink">{post.categories.map((category) => category.name).join(' · ')}</p>}
        <h2 className="mt-2 text-xl font-bold tracking-tight group-hover:underline">{post.title}</h2>
        {post.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{post.excerpt}</p>}
        <p className="mt-4 text-sm text-muted">{post.authorName && <>{post.authorName} · </>}<time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time></p>
      </div>
    </Link>
  </article>;
}
