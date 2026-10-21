import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@biznexa/types';
import { VerifyForm } from '@/components/verify-form';
import { QrScanner } from '@/components/qr-scanner';
import { CertificateResult } from '@/components/certificate-result';
import { Badge, Container, Notice, type Tone } from '@biznexa/ui';
import { searchOrganization, verifyCertificate } from '@/lib/verify';

export const metadata: Metadata = {
  title: 'Verify a certificate',
  description: 'Check whether a certificate issued through BizNexa is genuine and currently valid using its certificate number, verification ID or QR code.',
  alternates: { canonical: '/verify' },
};
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 100) || undefined;

const STATUS_TONE = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  EXPIRED: 'danger',
  WITHDRAWN: 'danger',
} satisfies Record<string, Tone>;

export default async function VerifyPage({ searchParams }: Readonly<{ searchParams: SP }>) {
  const sp = await searchParams;
  const number = one(sp.number);
  const id = one(sp.id);
  const organization = one(sp.organization);
  // Not trimmed to 100 like the others: Turnstile tokens are long. Used for this one lookup only.
  const captchaToken = (Array.isArray(sp.captchaToken) ? sp.captchaToken[0] : sp.captchaToken)?.slice(0, 2048) || undefined;

  const result = number || id ? await verifyCertificate({ number, id, captchaToken }) : null;
  const orgs = !result && organization ? await searchOrganization(organization) : null;
  let mode: 'id' | 'organization' | 'number' = 'number';
  if (id) {
    mode = 'id';
  } else if (organization) {
    mode = 'organization';
  }

  let orgHeading = `No certificates found for “${organization}”`;
  if (orgs?.ok && orgs.data.length) {
    const plural = orgs.data.length > 1 ? 's' : '';
    orgHeading = `${orgs.data.length} certificate${plural} for “${organization}”`;
  }

  return (
    <Container className="max-w-[860px] py-12">
      <h1 className="text-4xl font-bold tracking-[-0.025em]">Verify a certificate</h1>
      <p className="mt-2 max-w-[60ch] text-muted">Confirm that a certificate issued through BizNexa is genuine and still valid. No login needed.</p>

      <div className="mt-8 rounded-xl border border-rule bg-white p-6 sm:p-8">
        <VerifyForm
          initialMode={mode}
          initialValue={number ?? id ?? organization ?? ''}
          captchaRequired={result?.ok === false && !!result.captchaRequired}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        />
        <div className="mt-6 border-t border-rule pt-5">
          <QrScanner />
        </div>
      </div>

      <div className="mt-8">
        {result && !result.ok && <Notice tone="error">{result.message}</Notice>}
        {result?.ok && <CertificateResult result={result.data} query={number ?? id ?? ''} />}

        {orgs && !orgs.ok && <Notice tone="error">{orgs.message}</Notice>}
        {orgs?.ok && (
          <section aria-labelledby="org-h">
            <h2 id="org-h" className="text-lg font-semibold">
              {orgHeading}
            </h2>
            {orgs.data.length > 0 && (
              <ul className="mt-4 divide-y divide-rule rounded-lg border border-rule bg-white">
                {orgs.data.map((c) => (
                  <li key={c.verificationId}>
                    <Link href={`/verify/${c.verificationId}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-paper">
                      <span>
                        <span className="block font-medium">{c.organizationName}</span>
                        <span className="block text-sm text-muted">
                          {c.type} · <span className="num">{c.certificateNumber}</span>
                        </span>
                      </span>
                      <span className="flex items-center gap-3 text-sm">
                        <span className="num text-muted">until {formatDate(c.validUntil)}</span>
                        <Badge tone={STATUS_TONE[c.status]}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {!result && !orgs && (
        <section className="mt-10 grid gap-6 text-sm sm:grid-cols-3">
          <div>
            <h2 className="font-semibold">What you can check</h2>
            <p className="mt-1 text-muted">Organisation, certificate type, issue and expiry dates, certification body and current status.</p>
          </div>
          <div>
            <h2 className="font-semibold">Status meanings</h2>
            <p className="mt-1 text-muted">Active is valid today. Suspended is temporarily not valid. Expired or Withdrawn is no longer valid.</p>
          </div>
          <div>
            <h2 className="font-semibold">Your privacy</h2>
            <p className="mt-1 text-muted">We never show personal details of the certificate holder — only what is printed on the certificate.</p>
          </div>
        </section>
      )}
    </Container>
  );
}
