import Link from 'next/link';
import { formatDate } from '@biznexa/types';
import { Icon } from './icons';
import type { Schemas } from '@biznexa/api-client';

const STATUS = {
  ACTIVE: { label: 'Active', headline: 'Certificate verified', tone: 'text-seal', bg: 'bg-seal-050', ring: 'ring-seal/30', seal: '#0e8a5f' },
  SUSPENDED: { label: 'Suspended', headline: 'Certificate found — currently suspended', tone: 'text-amber', bg: 'bg-amber-050', ring: 'ring-amber/30', seal: '#b26a00' },
  EXPIRED: { label: 'Expired', headline: 'Certificate found — expired', tone: 'text-danger', bg: 'bg-danger-050', ring: 'ring-danger/30', seal: '#b42318' },
  WITHDRAWN: { label: 'Withdrawn', headline: 'Certificate found — withdrawn', tone: 'text-danger', bg: 'bg-danger-050', ring: 'ring-danger/30', seal: '#b42318' },
} as const;

function Seal({ color, ok }: { color: string; ok: boolean }) {
  return (
    <svg width="76" height="76" viewBox="0 0 80 80" aria-hidden="true" className="shrink-0">
      <g fill="none" stroke={color} strokeWidth="2">
        <circle cx="40" cy="40" r="36" strokeDasharray="3 3" />
        <circle cx="40" cy="40" r="29" />
      </g>
      {ok ? <path d="m27 41 9 9 17-19" fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M40 25v20M40 54v1" stroke={color} strokeWidth="4.5" strokeLinecap="round" />}
    </svg>
  );
}

export function CertificateResult({ result, query }: { result: Schemas['CertificateVerifyResult']; query: string }) {
  if (!result.found || !result.certificate) {
    return (
      <div role="status" className="rounded-xl border border-danger/25 bg-white p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-danger-050 text-danger">
            <Icon name="x" size={24} />
          </span>
          <div>
            <h2 className="text-xl font-bold">No certificate found for “{query}”</h2>
            <p className="mt-1 max-w-[60ch] text-muted">
              Check the number exactly as printed on the certificate, including dashes, or scan the QR code instead. If you still can’t find it, the certificate may not have been issued through BizNexa —{' '}
              <Link href="/contact" className="text-ink underline">
                contact us
              </Link>{' '}
              and we will check for you.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const c = result.certificate;
  const st = STATUS[c.status];
  const rows: [string, string][] = [
    ['Certificate number', c.certificateNumber],
    ['Verification ID', c.verificationId],
    ['Organisation', c.organizationName],
    ['Certificate type', c.type],
    ...(c.scope ? ([['Scope', c.scope]] as [string, string][]) : []),
    ['Issue date', formatDate(c.issueDate)],
    ['Valid from', formatDate(c.validFrom)],
    ['Expiry date', formatDate(c.validUntil)],
    ['Certification body', c.certificationBody.name],
  ];

  return (
    <article role="status" aria-labelledby="cert-h" className={`overflow-hidden rounded-xl bg-white ring-2 ${st.ring}`}>
      <header className={`flex items-center gap-5 px-6 py-6 sm:px-8 ${st.bg}`}>
        <Seal color={st.seal} ok={c.status === 'ACTIVE'} />
        <div>
          <h2 id="cert-h" className={`text-2xl font-bold tracking-[-0.02em] ${st.tone}`}>
            {st.headline}
          </h2>
          <p className="mt-1 text-night">
            Status: <span className={`font-semibold ${st.tone}`}>{st.label}</span>
          </p>
          {c.statusNote && <p className="mt-1 text-sm text-muted">{c.statusNote}</p>}
        </div>
      </header>

      <dl className="grid px-6 py-4 sm:grid-cols-[200px_1fr] sm:px-8">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="pt-3 text-sm text-muted sm:border-b sm:border-rule sm:pb-3">{k}</dt>
            <dd className="num border-b border-rule pb-3 font-medium sm:pt-3">{v}</dd>
          </div>
        ))}
      </dl>

      {c.pdfAvailable && (
        <div className="border-b border-rule bg-paper/50 px-6 py-4 sm:px-8">
          <a
            href={`/api/public/certificates/${encodeURIComponent(c.verificationId)}/download`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-night px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink focus:outline-none focus:ring-2 focus:ring-ink"
          >
            <Icon name="download" size={16} />
            Download Official Certificate (PDF)
          </a>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 px-6 pb-6 text-sm text-muted sm:px-8">
        <p>
          Checked on {formatDate(result.verifiedAt)} at{' '}
          {new Date(result.verifiedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST
        </p>
        {result.qrAuthentic === true && (
          <p className="flex items-center gap-1.5 font-medium text-seal">
            <Icon name="qr" size={16} /> Genuine BizNexa QR code
          </p>
        )}
        {result.qrAuthentic === false && (
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <Icon name="alert" size={16} /> This QR link was altered. Trust only the details above.
          </p>
        )}
      </footer>
    </article>
  );
}
