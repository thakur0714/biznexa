import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, LinkButton } from '@biznexa/ui';
import { api, type CategorySummary } from '@/lib/api';

export const revalidate = 300;
export const metadata: Metadata = {
  title: 'About BizNexa',
  description: 'BizNexa brings company registration, trademarks, tax, certification, licenses, compliance and business technology into one online platform.',
  alternates: { canonical: '/about' },
};

const PROMISES = [
  { title: 'One place for every requirement', body: 'From incorporation to annual filings, your services, documents, payments and certificates live in one account.' },
  { title: 'A named expert on every application', body: 'A qualified professional prepares and files your work, and you can message them from your dashboard.' },
  { title: 'Prices you see before you pay', body: 'Professional fee, GST and government fees are shown separately on every service page.' },
  { title: 'Progress you can see', body: 'Each application has a stage-by-stage timeline and you get an update whenever it moves.' },
];

export default async function AboutPage() {
  const categories = await api<CategorySummary[]>('/catalogue/categories').catch(() => []);
  return (
    <>
      <section className="border-b border-rule bg-white">
        <Container className="max-w-[900px] py-16">
          <h1 className="text-4xl font-bold tracking-[-0.025em] sm:text-5xl">Running a business in India involves a lot of paperwork. We handle it.</h1>
          <p className="mt-5 max-w-[62ch] text-lg text-muted">
            BizNexa is an online platform for founders, startups and MSMEs. Choose a service, submit your details, upload documents and pay online — then follow every step until your certificate or filing is ready to download.
          </p>
        </Container>
      </section>
      <Container className="max-w-[900px] py-14">
        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {PROMISES.map((p) => (
            <li key={p.title} className="border-t-2 border-night pt-4">
              <h2 className="text-lg font-semibold">{p.title}</h2>
              <p className="mt-1 text-muted">{p.body}</p>
            </li>
          ))}
        </ul>
        <h2 className="mt-16 text-2xl font-bold tracking-[-0.02em]">What we help with</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {categories.map((c) => (
            <li key={c.slug}>
              <Link href={`/services/${c.slug}`} className="block rounded-full border border-rule bg-white px-4 py-2 font-medium hover:border-ink hover:text-ink">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-12 flex flex-wrap gap-3">
          <LinkButton href="/services">Explore services</LinkButton>
          <LinkButton href="/contact" variant="outline">
            Contact us
          </LinkButton>
        </div>
      </Container>
    </>
  );
}
