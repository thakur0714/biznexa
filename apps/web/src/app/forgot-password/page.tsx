'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { passwordSchema } from '@biznexa/types';
import { AuthShell } from '@/components/auth-shell';
import { OtpStep, type OtpIssued } from '@/components/otp-step';
import { Button, Field, Notice } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { formText } from '@/lib/form';

function isValidTarget(t: string): boolean {
  return /^\d{10}$/.test(t) || /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(t);
}

export default function ForgotPasswordPage() {
  const router = useRouter();
  const api = useApi();
  const [target, setTarget] = useState('');
  const [issued, setIssued] = useState<OtpIssued | null>(null);
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const channel: 'MOBILE' | 'EMAIL' = /^\d{10}$/.test(target.trim()) ? 'MOBILE' : 'EMAIL';

  async function request(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = target.trim();
    if (!isValidTarget(t)) return setError('Enter your registered email or 10-digit mobile number.');
    setBusy(true);
    setError('');
    try {
      setIssued(await api.call<OtpIssued>((c) => c.POST('/api/auth/otp/request', { body: { channel, target: channel === 'EMAIL' ? t.toLowerCase() : t, purpose: 'RESET_PASSWORD' } })));
    } catch (err) {
      setError((err as ClientApiError).message);
    }
    setBusy(false);
  }

  async function reset(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const pw = formText(new FormData(e.currentTarget), 'password');
    const parsed = passwordSchema.safeParse(pw);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setBusy(true);
    setError('');
    try {
      const res = await api.call<{ message: string }>((c) => c.POST('/api/auth/password/reset', { body: { resetToken, password: pw } }));
      setDone(res.message);
      setTimeout(() => router.push('/login'), 1800);
    } catch (err) {
      setError((err as ClientApiError).message);
    }
    setBusy(false);
  }

  let body: React.ReactNode;
  if (done) {
    body = <Notice tone="success">{done}</Notice>;
  } else if (resetToken) {
    body = (
      <form onSubmit={reset} noValidate className="space-y-4">
        <Field id="password" name="password" type="password" label="New password" autoComplete="new-password" hint="At least 8 characters with a letter and a number" error={error || undefined} />
        <Button type="submit" variant="ink" className="w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    );
  } else if (issued) {
    const formattedTarget = channel === 'EMAIL' ? target.trim().toLowerCase() : target.trim();
    body = (
      <OtpStep<{ resetToken: string }>
        channel={channel}
        target={formattedTarget}
        purpose="RESET_PASSWORD"
        issued={issued}
        onVerified={(r) => setResetToken(r.resetToken)}
        onChangeTarget={() => setIssued(null)}
      />
    );
  } else {
    body = (
      <form onSubmit={request} noValidate className="space-y-4">
        <Field id="target" label="Email or mobile number" value={target} onChange={(e) => setTarget(e.target.value)} autoComplete="username" error={error || undefined} />
        <Button type="submit" variant="ink" className="w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Send code'}
        </Button>
        <p className="text-center text-sm">
          <Link href="/login" className="text-ink underline">
            Back to log in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll send a one-time code to your registered email or mobile.">
      {body}
    </AuthShell>
  );
}
