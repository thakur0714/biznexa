import type { MetadataRoute } from 'next';
import { api, type CategorySummary, type ServiceList } from '@/lib/api';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const statics = ['', '/services', '/verify', '/about', '/contact', '/consultants', '/blog', '/terms', '/privacy', '/refund-policy'].map((p) => ({
    url: `${site}${p}`,
    changeFrequency: 'weekly' as const,
    priority: p === '' ? 1 : 0.6,
  }));
  try {
    const [cats, services] = await Promise.all([
      api<CategorySummary[]>('/catalogue/categories'),
      api<ServiceList>('/catalogue/services?limit=60').then(async (first) => {
        const rest = await Promise.all(Array.from({ length: first.pages - 1 }, (_, i) => api<ServiceList>(`/catalogue/services?limit=60&page=${i + 2}`)));
        return [first, ...rest].flatMap((p) => p.items);
      }),
    ]);
    return [
      ...statics,
      ...cats.map((c) => ({ url: `${site}/services/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
      ...services.map((s) => ({ url: `${site}/services/${s.category.slug}/${s.slug}`, changeFrequency: 'weekly' as const, priority: 0.9 })),
    ];
  } catch {
    return statics;
  }
}
