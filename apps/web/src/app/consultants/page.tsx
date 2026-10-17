import type { Metadata } from 'next';
import Link from 'next/link';
import { LeadForm } from '@/components/lead-form';
import { Icon } from '@/components/icons';
import { Container } from '@biznexa/ui';

export const metadata: Metadata = { title: 'Consult an expert', description: 'Talk to CAs, CSs, lawyers, tax, trademark, ISO, business and technology consultants.', alternates: { canonical: '/consultants' } };

const TYPES = ['Chartered Accountant (CA)', 'Company Secretary (CS)', 'Lawyer', 'Tax Consultant', 'Trademark Consultant', 'ISO Consultant', 'Business Consultant', 'Technology Consultant'];

/** Consultant directory and booking arrive in Milestone 8; until then this page takes call-back requests. */
export default function ConsultantsPage() {
  return (
    <Container className="grid grid-cols-1 gap-12 py-14 lg:grid-cols-[1fr_420px]">
      <div>
        <h1 className="text-4xl font-bold tracking-[-0.025em]">Consult an expert</h1>
        <p className="mt-3 max-w-[58ch] text-lg text-muted">
          Get advice from a verified professional before you file, sign or decide. Online booking with audio, video and chat consultations is launching soon — for now, request a call back and we will connect you with the right expert.
        </p>
        <Link href="/consultants/apply" className="mt-5 inline-flex min-h-11 items-center rounded-md border border-rule bg-white px-4 font-semibold text-ink hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Apply as a consultant</Link>
        <h2 className="mt-10 font-semibold">Experts available</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {TYPES.map((t) => (
            <li key={t} className="flex items-center gap-2.5 rounded-md bg-white px-4 py-3 ring-1 ring-rule">
              <Icon name="people" size={18} className="text-ink" />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="self-start rounded-xl border-2 border-night bg-white p-6 shadow-[6px_6px_0_0_#121a45]">
        <h2 className="text-xl font-bold">Request a consultation</h2>
        <p className="mt-1 text-sm text-muted">Mention the topic so we match the right professional.</p>
        <div className="mt-5">
          <LeadForm source="consultants" compact withMessage />
        </div>
      </div>
    </Container>
  );
}
