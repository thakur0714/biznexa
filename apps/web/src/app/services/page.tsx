import type { Metadata } from 'next';
import { SearchBox } from '@/components/search-box';
import { ServiceListing, apiQuery, normalizeParams } from '@/components/service-listing';
import { Breadcrumbs, Container } from '@biznexa/ui';
import { api, type CategorySummary, type ServiceList } from '@/lib/api';

export const metadata: Metadata = {
  title: 'All business services',
  description: 'Company registration, trademark, GST, income tax, ISO certification, licenses, compliance and business technology services with clear prices and timelines.',
  alternates: { canonical: '/services' },
};

export default async function AllServicesPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = normalizeParams(await searchParams);
  const [data, categories] = await Promise.all([
    api<ServiceList>(`/catalogue/services?${apiQuery(params)}`, { revalidate: 60 }),
    api<CategorySummary[]>('/catalogue/categories'),
  ]);

  return (
    <>
      <section className="border-b border-rule bg-white">
        <Container className="py-10">
          <Breadcrumbs items={[{ href: '/', label: 'Home' }, { label: 'All services' }]} />
          <h1 className="mt-4 text-4xl font-bold tracking-[-0.025em]">All services</h1>
          <p className="mt-2 max-w-[60ch] text-muted">Every service shows its starting price and expected timeline. Open a service to see packages, documents and the full process.</p>
          <div className="mt-6 max-w-[560px]">
            <SearchBox size="md" defaultValue={params.q ?? ''} />
          </div>
        </Container>
      </section>
      <Container className="py-10">
        <ServiceListing basePath="/services" params={params} data={data} categories={categories} />
      </Container>
    </>
  );
}
