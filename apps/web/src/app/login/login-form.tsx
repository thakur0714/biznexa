'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { OtpStep, type OtpIssued } from '@/components/otp-step';
import { Button, Field, Notice } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { safeNext, useAuth, type SessionUser } from '@/lib/auth';

type Session = { accessToken: string; user: SessionUser };

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeNext(sp.get('next'));
  const { signIn, user, ready } = useAuth();
  const api = useApi();
  const [method, setMethod] = useState<'password' | 'otp'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [mobile, setMobile] = useState('');
  const [issued, setIssued] = useState<OtpIssued | null>(null);

  useEffect(() => {
    if (ready && user) router.replace(next);
  }, [ready, user, next, router]);

  function done(s: Session) {
    signIn(s);
    router.replace(next);
  }

  async function passwordLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      done(await api.call<Session>((c) => c.POST('/api/auth/login', { body: { email: String(f.get('email') ?? ''), password: String(f.get('password') ?? '') } })));
    } catch (err) {
      setError(err as ClientApiError);
      setBusy(false);
    }
  }

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setIssued(await api.call<OtpIssued>((c) => c.POST('/api/auth/otp/request', { body: { channel: 'MOBILE', target: mobile.trim(), purpose: 'LOGIN' } })));
    } catch (err) {
      setError(err as ClientApiError);
    }
    setBusy(false);
  }

  const tab = (key: 'password' | 'otp', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={method === key}
      onClick={() => {
        setMethod(key);
        setError(null);
      }}
      className={`flex-1 rounded px-3 py-2 text-sm font-medium ${method === key ? 'bg-white text-ink shadow-sm ring-1 ring-rule' : 'text-muted'}`}
    >
      {label}
    </button>
  );

  return (
    <AuthShell
      title="Log in to BizNexa"
      subtitle={
        <>
          New here?{' '}
          <Link href={`/register${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-ink underline">
            Create an account
          </Link>
        </>
      }
    >
      <div role="tablist" aria-label="Login method" className="flex rounded-md border border-rule bg-paper p-1">
        {tab('password', 'Email & password')}
        {tab('otp', 'Mobile OTP')}
      </div>

      <div className="mt-6">
        {method === 'password' ? (
          <form onSubmit={passwordLogin} noValidate className="space-y-4">
            <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={error?.fieldError('email')} />
            <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" required error={error?.fieldError('password')} />
            <div className="text-right text-sm">
              <Link href="/forgot-password" className="font-medium text-ink hover:underline">
                Forgot password?
              </Link>
            </div>
            {error && error.errors.length === 0 && <Notice tone="error">{error.message}</Notice>}
            <Button type="submit" variant="ink" className="w-full" disabled={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
        ) : issued ? (
          <OtpStep<Session> channel="MOBILE" target={mobile.trim()} purpose="LOGIN" issued={issued} onVerified={done} onChangeTarget={() => setIssued(null)} />
        ) : (
          <form onSubmit={requestOtp} noValidate className="space-y-4">
            <Field
              id="mobile"
              label="Mobile number"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              hint="We'll send a 6-digit code to this number."
              error={error?.fieldError('target')}
            />
            {error && error.errors.length === 0 && <Notice tone="error">{error.message}</Notice>}
            <Button type="submit" variant="ink" className="w-full" disabled={busy || mobile.length !== 10}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
