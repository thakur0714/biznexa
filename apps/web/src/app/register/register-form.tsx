'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { registerSchema } from '@biznexa/types';
import { AuthShell } from '@/components/auth-shell';
import { OtpStep, type OtpIssued } from '@/components/otp-step';
import { Button, Field, Notice } from '@biznexa/ui';
import { ClientApiError, type FieldError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { safeNext, useAuth, type SessionUser } from '@/lib/auth';

type Session = { accessToken: string; user: SessionUser };

export function RegisterForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { signIn } = useAuth();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState<{ mobile: string; otp: OtpIssued } | null>(null);

  const err = (f: string) => errors.find((e) => e.field === f)?.message;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = {
      name: String(f.get('name') ?? ''),
      mobile: String(f.get('mobile') ?? ''),
      email: String(f.get('email') ?? ''),
      password: String(f.get('password') ?? ''),
      consent: f.get('consent') === 'on',
    };
    // Same rules as the API, so mistakes show before a round trip.
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => ({ field: String(i.path[0]), message: i.message })));
      return;
    }
    setBusy(true);
    setErrors([]);
    setFormError('');
    try {
      const res = await api.call<Session & { otp: OtpIssued }>((c) => c.POST('/api/auth/register', { body: parsed.data }));
      signIn(res);
      setPending({ mobile: parsed.data.mobile, otp: res.otp });
    } catch (e) {
      const ce = e as ClientApiError;
      if (ce.errors.length) setErrors(ce.errors);
      else setFormError(ce.message);
    }
    setBusy(false);
  }

  if (pending) {
    return (
      <AuthShell title="Verify your mobile number" subtitle="One last step so we can send you application updates by SMS.">
        <OtpStep<Session>
          channel="MOBILE"
          target={pending.mobile}
          purpose="VERIFY_MOBILE"
          issued={pending.otp}
          onVerified={(s) => {
            signIn(s);
            router.replace(next);
          }}
        />
        <p className="mt-6 text-center text-sm">
          <button type="button" onClick={() => router.replace(next)} className="text-muted underline">
            I&apos;ll do this later
          </button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already have an account?{' '}
          <Link href={`/login${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-ink underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field id="name" name="name" label="Full name" autoComplete="name" required error={err('name')} />
        <Field id="mobile" name="mobile" label="Mobile number" inputMode="numeric" autoComplete="tel-national" maxLength={10} required error={err('mobile')} hint="10 digits, without +91" />
        <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={err('email')} />
        <Field id="password" name="password" type="password" label="Password" autoComplete="new-password" required error={err('password')} hint="At least 8 characters with a letter and a number" />
        <div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="consent" className="mt-0.5 accent-ink" aria-invalid={!!err('consent')} />
            <span>
              I agree to the{' '}
              <Link href="/terms" className="text-ink underline" target="_blank">
                Terms
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-ink underline" target="_blank">
                Privacy Policy
              </Link>
              , and consent to BizNexa processing my details to provide services.
            </span>
          </label>
          {err('consent') && <p className="mt-1.5 text-sm text-danger">{err('consent')}</p>}
        </div>
        {formError && <Notice tone="error">{formError}</Notice>}
        <Button type="submit" variant="ink" className="w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
