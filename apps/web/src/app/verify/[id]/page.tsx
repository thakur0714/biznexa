import type { Metadata } from 'next';
import Link from 'next/link';
import { CertificateResult } from '@/components/certificate-result';
import { VerifyQrCaptcha } from '@/components/verify-qr-captcha';
import { Container, Notice } from '@biznexa/ui';
import { verifyCertificate } from '@/lib/verify';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Certificate verification', robots: { index: false } };

/** Landing page for QR codes: /verify/{verificationId}?t={signature} */
export default async function VerifyByIdPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[]; captchaToken?: string | string[] }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tStr = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const captchaToken = (Array.isArray(sp.captchaToken) ? sp.captchaToken[0] : sp.captchaToken)?.slice(0, 2048) || undefined;

  const cleanId = id.replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  const cleanT = tStr?.slice(0, 32);

  const result = await verifyCertificate({ id: cleanId, t: cleanT, captchaToken });

  return (
    <Container className="max-w-[860px] py-12">
      <h1 className="text-4xl font-bold tracking-[-0.025em]">Certificate verification</h1>
      <p className="mt-2 text-muted">
        Result for verification ID <span className="num font-medium text-night">{cleanId.toUpperCase()}</span>
      </p>
      <div className="mt-8">
        {result.ok ? <CertificateResult result={result.data} query={cleanId.toUpperCase()} /> : <Notice tone="error">{result.message}</Notice>}
        <VerifyQrCaptcha
          id={cleanId}
          t={cleanT}
          captchaRequired={result.ok === false && !!result.captchaRequired}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        />
      </div>
      <p className="mt-8 text-sm">
        <Link href="/verify" className="font-semibold text-ink hover:underline">
          Verify another certificate
        </Link>
      </p>
    </Container>
  );
}
