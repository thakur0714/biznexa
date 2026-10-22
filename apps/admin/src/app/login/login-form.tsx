'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo, Button, Field, Notice } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { afterSignIn, safeNext, useAuth, type SessionResponse } from '@/lib/auth';
import { formText } from '@/lib/form';

/** Staff sign-in with email + password against the shared auth API; the 2FA step follows (/two-factor). */
export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { signIn, user, ready, denied } = useAuth();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ClientApiError | null>(null);

  useEffect(() => {
    if (ready && user) router.replace(afterSignIn(user, next));
  }, [ready, user, next, router]);

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const session = await api.call<SessionResponse>((c) => c.POST('/api/auth/login', { body: { email: formText(f, 'email'), password: formText(f, 'password') } }));
      if (await signIn(session)) {
        router.replace(afterSignIn(session.user, next));
        return;
      }
    } catch (err) {
      setError(err as ClientApiError);
    }
    setBusy(false);
  }

  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <Logo tag="Admin" />
        <h1 className="mt-8 text-2xl font-bold tracking-[-0.02em]">Staff login</h1>
        <p className="mt-1 text-muted">For BizNexa admins, operations, support and consultants.</p>

        <form onSubmit={submit} noValidate className="mt-8 space-y-4 rounded-lg border border-rule bg-white p-6">
          <Field id="email" name="email" type="email" label="Work email" autoComplete="username" required error={error?.fieldError('email')} />
          <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" required error={error?.fieldError('password')} />
          {denied && !error && (
            <Notice tone="error">This account is not allowed to use the admin portal. Customers can log in on the BizNexa website.</Notice>
          )}
          {error?.errors.length === 0 && <Notice tone="error">{error.message}</Notice>}
          <Button type="submit" variant="ink" className="w-full" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
