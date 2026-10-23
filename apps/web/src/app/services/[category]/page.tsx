import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceListing, apiQuery, normalizeParams } from '@/components/service-listing';
import { Icon } from '@/components/icons';
import { Breadcrumbs, Container } from '@biznexa/ui';
import { api, apiOrNull, type CategoryDetail, type CategorySummary, type ServiceList } from '@/lib/api';
import { CategorySeo } from './category-seo';

type Props = { params: Promise<{ category: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function getCategory(slug: string) {
  const categories = await api<CategorySummary[]>('/catalogue/categories');
  return { categories, category: categories.find((c) => c.slug === slug) };
}

function getCategoryDetail(slug: string) {
  return apiOrNull<CategoryDetail>(`/catalogue/categories/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({ params }: Readonly<Props>): Promise<Metadata> {
  const category = await getCategoryDetail((await params).category);
  if (!category) return {};
  return {
    title: category.seoTitle?.replace(/ \| BizNexa$/, '') ?? `${category.name} services`,
    description: category.metaDescription ?? category.description ?? undefined,
    alternates: { canonical: `/services/${category.slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Readonly<Props>) {
  const slug = (await params).category;
  const [{ categories, category }, detail] = await Promise.all([getCategory(slug), getCategoryDetail(slug)]);
  if (!category || !detail) notFound();
  const p = normalizeParams(await searchParams);
  const data = await api<ServiceList>(`/catalogue/services?${apiQuery(p, slug)}`, { revalidate: 60 });

  return (
    <>
      <section className="border-b border-rule bg-white">
        <Container className="py-10">
          <Breadcrumbs items={[{ href: '/', label: 'Home' }, { href: '/services', label: 'Services' }, { label: category.name }]} />
          <div className="mt-5 flex items-start gap-4">
            <span className="hidden h-14 w-14 shrink-0 place-items-center rounded-lg bg-ink text-white sm:grid">
              <Icon name={category.icon ?? 'file'} size={28} />
            </span>
            <div>
              <h1 className="text-4xl font-bold tracking-[-0.025em]">{category.name} services</h1>
              <p className="mt-2 max-w-[62ch] text-muted">{category.description}</p>
            </div>
          </div>
        </Container>
      </section>
      <Container className="py-10">
        <ServiceListing basePath={`/services/${slug}`} params={p} data={data} categories={categories} category={category} />
      </Container>
      <CategorySeo category={detail} />
    </>
  );
}
