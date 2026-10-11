import type { Metadata } from 'next';
import Link from 'next/link';
import { CertificateResult } from '@/components/certificate-result';
import { Container, Notice } from '@biznexa/ui';
import { verifyCertificate } from '@/lib/verify';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Certificate verification', robots: { index: false } };

/** Landing page for QR codes: /verify/{verificationId}?t={signature} */
export default async function VerifyByIdPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const cleanId = id.replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  const result = await verifyCertificate({ id: cleanId, t: t?.slice(0, 32) });

  return (
    <Container className="max-w-[860px] py-12">
      <h1 className="text-4xl font-bold tracking-[-0.025em]">Certificate verification</h1>
      <p className="mt-2 text-muted">
        Result for verification ID <span className="num font-medium text-night">{cleanId.toUpperCase()}</span>
      </p>
      <div className="mt-8">{result.ok ? <CertificateResult result={result.data} query={cleanId.toUpperCase()} /> : <Notice tone="error">{result.message}</Notice>}</div>
      <p className="mt-8 text-sm">
        <Link href="/verify" className="font-semibold text-ink hover:underline">
          Verify another certificate
        </Link>
      </p>
    </Container>
  );
}
