import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatINR } from '@biznexa/types';
import { PricingCard } from '@/components/pricing-card';
import { LeadForm } from '@/components/lead-form';
import { ServiceCard } from '@/components/service-card';
import { Icon } from '@/components/icons';
import { Badge, Breadcrumbs, Container, Table } from '@biznexa/ui';
import { apiOrNull, type ServiceDetail } from '@/lib/api';

type Props = { params: Promise<{ category: string; service: string }> };

export const revalidate = 120;

async function getService(slug: string) {
  return apiOrNull<ServiceDetail>(`/catalogue/services/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, service } = await params;
  const s = await getService(service);
  if (!s) return {};
  const canonical = `/services/${s.category.slug}/${s.slug}`;
  return {
    title: s.seoTitle?.replace(/ \| BizNexa$/, '') ?? s.name,
    description: s.metaDescription ?? s.shortDescription,
    alternates: { canonical: category === s.category.slug ? canonical : canonical },
    openGraph: { title: s.name, description: s.shortDescription, url: canonical },
  };
}

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Documents' },
  { id: 'process', label: 'Process' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faqs', label: 'FAQs' },
];

export default async function ServicePage({ params }: Props) {
  const { category, service } = await params;
  const s = await getService(service);
  if (!s || s.category.slug !== category) notFound();

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const url = `${site}/services/${s.category.slug}/${s.slug}`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: s.name,
      description: s.shortDescription,
      url,
      provider: { '@type': 'Organization', name: 'BizNexa', url: site },
      areaServed: { '@type': 'Country', name: 'India' },
      offers: s.packages.map((p) => ({ '@type': 'Offer', name: p.name, price: (p.price.total / 100).toFixed(2), priceCurrency: 'INR' })),
    },
    s.faqs.length && {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: s.faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: site },
        { '@type': 'ListItem', position: 2, name: s.category.name, item: `${site}/services/${s.category.slug}` },
        { '@type': 'ListItem', position: 3, name: s.name, item: url },
      ],
    },
  ].filter(Boolean);

  // The hero already shows the short description, so don't repeat it as the first overview paragraph.
  const paragraphs = (s.overview ?? s.shortDescription).split(/\n{2,}/).filter((p, i, all) => !(i === 0 && all.length > 1 && p.trim() === s.shortDescription.trim()));

  return (
    <div className="pb-24 lg:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <section className="border-b border-rule bg-white">
        <Container className="py-10">
          <Breadcrumbs items={[{ href: '/', label: 'Home' }, { href: `/services/${s.category.slug}`, label: s.category.name }, { label: s.name }]} />
          <h1 className="mt-4 max-w-[22ch] text-[34px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[44px]">{s.name}</h1>
          <p className="mt-3 max-w-[60ch] text-lg text-muted">{s.shortDescription}</p>
          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
            {s.startingPrice != null && (
              <div>
                <dt className="text-sm text-muted">Starting from</dt>
                <dd className="num text-2xl font-bold">{formatINR(s.startingPrice)}</dd>
              </div>
            )}
            {s.estimatedTime && (
              <div>
                <dt className="text-sm text-muted">Estimated time</dt>
                <dd className="text-2xl font-bold">{s.estimatedTime}</dd>
              </div>
            )}
            <div>
              <dt className="text-sm text-muted">Process</dt>
              <dd className="text-2xl font-bold">100% online</dd>
            </div>
          </dl>
        </Container>
      </section>

      <nav aria-label="On this page" className="sticky top-16 z-20 border-b border-rule bg-white/95 backdrop-blur">
        <Container className="flex gap-1 overflow-x-auto py-2 text-sm">
          {SECTIONS.map((x) => (
            <a key={x.id} href={`#${x.id}`} className="shrink-0 rounded-md px-3 py-1.5 font-medium text-muted hover:bg-ink-050 hover:text-ink">
              {x.label}
            </a>
          ))}
        </Container>
      </nav>

      <Container className="grid grid-cols-1 gap-10 py-10 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-14">
          <section id="overview" aria-labelledby="overview-h" className="scroll-mt-32">
            <h2 id="overview-h" className="text-2xl font-bold tracking-[-0.02em]">
              Overview
            </h2>
            <div className="prose-plain mt-3 max-w-[68ch] text-[17px] leading-relaxed text-night/90">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {s.benefits.length > 0 && (
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {s.benefits.map((b) => (
                  <li key={b} className="flex gap-2.5 rounded-md bg-white p-3.5 ring-1 ring-rule">
                    <Icon name="check" size={18} className="mt-0.5 shrink-0 text-seal" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section id="documents" aria-labelledby="docs-h" className="scroll-mt-32">
            <h2 id="docs-h" className="text-2xl font-bold tracking-[-0.02em]">
              Documents required
            </h2>
            <p className="mt-2 text-muted">Clear scans or phone photos are fine. You can upload them after payment too.</p>
            <ul className="mt-5 divide-y divide-rule rounded-lg border border-rule bg-white">
              {s.documents.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
                  <span className="flex gap-3">
                    <Icon name="file" size={20} className="mt-0.5 shrink-0 text-ink" />
                    <span>
                      {d.name}
                      {d.description && <span className="block text-sm text-muted">{d.description}</span>}
                    </span>
                  </span>
                  <Badge tone={d.isMandatory ? 'info' : 'neutral'}>{d.isMandatory ? 'Required' : 'If applicable'}</Badge>
                </li>
              ))}
            </ul>
          </section>

          <section id="process" aria-labelledby="process-h" className="scroll-mt-32">
            <h2 id="process-h" className="text-2xl font-bold tracking-[-0.02em]">
              How it works
            </h2>
            <p className="mt-2 text-muted">You can follow each of these stages from your dashboard.{s.estimatedTime ? ` Usually ${s.estimatedTime.toLowerCase()}.` : ''}</p>
            <ol className="mt-6">
              {s.stages.map((st, i) => (
                <li key={st.id} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < s.stages.length - 1 && <span aria-hidden="true" className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5 bg-rule" />}
                  <span className="num relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-night bg-white text-sm font-bold">{i + 1}</span>
                  <div className="pt-1">
                    <p className="font-semibold">{st.name}</p>
                    {st.description && <p className="text-sm text-muted">{st.description}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="pricing" aria-labelledby="pricing-h" className="scroll-mt-32">
            <h2 id="pricing-h" className="text-2xl font-bold tracking-[-0.02em]">
              Compare packages
            </h2>
            <div className="mt-5">
              <Table caption={`Package prices for ${s.name}`}>
                <thead>
                  <tr className="border-b border-rule">
                    <th scope="col" className="p-4 font-medium text-muted"></th>
                    {s.packages.map((p) => (
                      <th key={p.id} scope="col" className="p-4 text-base font-semibold">
                        {p.name}
                        {p.isMostPopular && (
                          <Badge tone="accent" className="ml-2">
                            Most chosen
                          </Badge>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  <tr>
                    <th scope="row" className="p-4 font-medium text-muted">Professional fee</th>
                    {s.packages.map((p) => <td key={p.id} className="p-4 font-semibold">{formatINR(p.professionalFee)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row" className="p-4 font-medium text-muted">GST</th>
                    {s.packages.map((p) => <td key={p.id} className="p-4">{formatINR(p.price.totalTax)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row" className="p-4 font-medium text-muted">Government fee</th>
                    {s.packages.map((p) => <td key={p.id} className="p-4">{p.governmentFee ? formatINR(p.governmentFee) : 'None'}</td>)}
                  </tr>
                  <tr className="bg-paper">
                    <th scope="row" className="p-4 font-semibold">Total</th>
                    {s.packages.map((p) => <td key={p.id} className="p-4 text-base font-bold">{formatINR(p.price.total)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row" className="p-4 align-top font-medium text-muted">Includes</th>
                    {s.packages.map((p) => (
                      <td key={p.id} className="p-4 align-top">
                        <ul className="space-y-1.5">
                          {p.inclusions.map((i) => (
                            <li key={i} className="flex gap-1.5">
                              <Icon name="check" size={15} className="mt-0.5 shrink-0 text-seal" />
                              {i}
                            </li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </Table>
            </div>
            <p className="mt-3 text-sm text-muted">Government fees are paid to the authority on your behalf and are not subject to GST. Final GST split (CGST + SGST or IGST) depends on your state.</p>
          </section>

          {s.faqs.length > 0 && (
            <section id="faqs" aria-labelledby="faqs-h" className="scroll-mt-32">
              <h2 id="faqs-h" className="text-2xl font-bold tracking-[-0.02em]">
                Frequently asked questions
              </h2>
              <div className="mt-5 divide-y divide-rule rounded-lg border border-rule bg-white">
                {s.faqs.map((f) => (
                  <details key={f.question} className="group px-5 py-4">
                    <summary className="flex items-center justify-between gap-4 font-medium">
                      {f.question}
                      <Icon name="chevronDown" size={18} className="chev shrink-0 text-muted transition-transform" />
                    </summary>
                    <p className="mt-2 max-w-[68ch] text-muted">{f.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          <section id="expert" aria-labelledby="expert-h" className="scroll-mt-32 rounded-lg border border-rule bg-white p-6 sm:p-8">
            <h2 id="expert-h" className="text-2xl font-bold tracking-[-0.02em]">
              Have a question first?
            </h2>
            <p className="mt-1 text-muted">Leave your number and an expert will call you about {s.name.toLowerCase()} within one working day.</p>
            <div className="mt-6">
              <LeadForm source="service_page" serviceId={s.id} />
            </div>
          </section>
        </div>

        <aside aria-label="Price and packages" className="lg:sticky lg:top-32 lg:self-start">
          <PricingCard serviceSlug={s.slug} packages={s.packages} />
        </aside>
      </Container>

      {s.related.length > 0 && (
        <section aria-labelledby="related-h">
          <Container className="pt-6">
            <h2 id="related-h" className="text-2xl font-bold tracking-[-0.02em]">
              Related services
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.related.map((r) => (
                <ServiceCard key={r.id} service={r} />
              ))}
            </div>
            <p className="mt-6 text-sm">
              <Link href={`/services/${s.category.slug}`} className="font-semibold text-ink hover:underline">
                All {s.category.name} services
              </Link>
            </p>
          </Container>
        </section>
      )}
    </div>
  );
}
