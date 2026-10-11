import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@biznexa/ui';

export const metadata: Metadata = { title: 'Resources', description: 'Guides and updates on GST, tax, trademarks, compliance and certification for Indian businesses.', alternates: { canonical: '/blog' } };

const TOPICS = ['Business Articles', 'Tax Updates', 'Trademark', 'GST', 'Compliance Updates', 'Certification'];

/** The Knowledge Center (CMS + blog) is Milestone 9. */
export default function BlogPage() {
  return (
    <Container className="max-w-[820px] py-14">
      <h1 className="text-4xl font-bold tracking-[-0.025em]">Resources</h1>
      <p className="mt-3 max-w-[58ch] text-lg text-muted">Plain-language guides and regulatory updates for business owners. The first articles are being written.</p>
      <ul className="mt-8 flex flex-wrap gap-2">
        {TOPICS.map((t) => (
          <li key={t} className="rounded-full border border-rule bg-white px-4 py-2 text-sm">
            {t}
          </li>
        ))}
      </ul>
      <p className="mt-10 text-muted">
        Have a question right now?{' '}
        <Link href="/contact" className="font-medium text-ink underline">
          Ask an expert
        </Link>
        .
      </p>
    </Container>
  );
}
