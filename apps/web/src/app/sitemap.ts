import type { MetadataRoute } from 'next';
import { api, type CategorySummary, type ServiceList } from '@/lib/api';
import type { PublicBlogPagedList, PublicBlogTaxonomy } from '@biznexa/types';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const statics = ['', '/services', '/verify', '/about', '/contact', '/consultants', '/blog', '/terms', '/privacy', '/refund-policy'].map((p) => ({
    url: `${site}${p}`,
    changeFrequency: 'weekly' as const,
    priority: p === '' ? 1 : 0.6,
  }));
  try {
    const [cats, services, blogCategories, blogTags, blogFirst] = await Promise.all([
      api<CategorySummary[]>('/catalogue/categories'),
      api<ServiceList>('/catalogue/services?limit=60').then(async (first) => {
        const rest = await Promise.all(Array.from({ length: first.pages - 1 }, (_, i) => api<ServiceList>(`/catalogue/services?limit=60&page=${i + 2}`)));
        return [first, ...rest].flatMap((p) => p.items);
      }),
      api<PublicBlogTaxonomy[]>('/public/blog/categories', { revalidate: 3600 }),
      api<PublicBlogTaxonomy[]>('/public/blog/tags', { revalidate: 3600 }),
      api<PublicBlogPagedList>('/public/blog/posts?page=1&pageSize=50', { revalidate: 3600 }),
    ]);
    const blogPosts = [blogFirst, ...await Promise.all(Array.from({ length: Math.max(0, blogFirst.pages - 1) }, (_, i) => api<PublicBlogPagedList>(`/public/blog/posts?page=${i + 2}&pageSize=50`, { revalidate: 3600 })))].flatMap((p) => p.items);
    return [
      ...statics,
      ...cats.map((c) => ({ url: `${site}/services/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
      ...services.map((s) => ({ url: `${site}/services/${s.category.slug}/${s.slug}`, changeFrequency: 'weekly' as const, priority: 0.9 })),
      ...blogCategories.map((c) => ({ url: `${site}/blog/category/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.6 })),
      ...blogTags.map((t) => ({ url: `${site}/blog/tag/${t.slug}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
      ...blogPosts.map((p) => ({ url: `${site}/blog/${p.slug}`, lastModified: p.publishedAt, changeFrequency: 'monthly' as const, priority: 0.7 })),
    ];
  } catch {
    return statics;
  }
}
