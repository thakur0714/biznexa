import type { Metadata } from 'next';
import { LeadForm } from '@/components/lead-form';
import { Icon } from '@/components/icons';
import { Container } from '@biznexa/ui';
import { api } from '@/lib/api';
import { RichText } from '@/components/rich-text';

export const revalidate = 300;
export const metadata: Metadata = { title: 'Contact us', description: 'Talk to a BizNexa expert about registration, tax, compliance, certification or technology services.', alternates: { canonical: '/contact' } };

export default async function ContactPage() {
  const [settings, page] = await Promise.all([
    api<Record<string, unknown>>('/cms/settings/public').catch(() => ({}) as Record<string, unknown>),
    api<{ content?: { html?: string }; contactEmail?: string | null; contactPhone?: string | null }>('/cms/pages/contact').catch(() => null),
  ]);
  const email = page?.contactEmail || (settings['company.email'] as string) || 'support@biznexa.com';
  const phone = page?.contactPhone || (settings['company.phone'] as string | undefined);

  return (
    <Container className="grid grid-cols-1 gap-12 py-14 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="text-4xl font-bold tracking-[-0.025em]">Contact us</h1>
        {page?.content?.html ? <RichText html={page.content.html} className="mt-4" /> : <p className="mt-2 max-w-[56ch] text-muted">Tell us what you need. An expert will call you within one working day — or email us anytime.</p>}
        <div className="mt-8 rounded-xl border border-rule bg-white p-6 sm:p-8">
          <LeadForm source="contact" withMessage />
        </div>
      </div>
      <aside className="space-y-6 self-start rounded-xl bg-white p-6 ring-1 ring-rule">
        <div className="flex gap-3">
          <Icon name="file" className="mt-0.5 shrink-0 text-ink" />
          <div>
            <h2 className="font-semibold">Email</h2>
            <a href={`mailto:${email}`} className="text-ink underline">
              {email}
            </a>
          </div>
        </div>
        {phone && (
          <div className="flex gap-3">
            <Icon name="phone" className="mt-0.5 shrink-0 text-ink" />
            <div>
              <h2 className="font-semibold">Phone</h2>
              <a href={`tel:${phone}`} className="text-ink underline">
                {phone}
              </a>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <Icon name="clock" className="mt-0.5 shrink-0 text-ink" />
          <div>
            <h2 className="font-semibold">Working hours</h2>
            <p className="text-muted">Monday to Saturday, 10:00 to 19:00 IST</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Icon name="people" className="mt-0.5 shrink-0 text-ink" />
          <div>
            <h2 className="font-semibold">Already a customer?</h2>
            <p className="text-muted">Message your expert from the application page in your dashboard for the fastest reply.</p>
          </div>
        </div>
      </aside>
    </Container>
  );
}
