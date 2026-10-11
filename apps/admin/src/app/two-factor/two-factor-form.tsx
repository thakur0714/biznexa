'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { needsTwoFactor, type TwoFactorSetup } from '@biznexa/types';
import { Button, Field, Logo, Notice } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { safeNext, useAuth, type SessionResponse } from '@/lib/auth';

/** Groups the key in fours so it is easier to type into an app. */
const groupKey = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/**
 * Login step two for staff (D27). First time: set up an authenticator app from a QR code and confirm
 * with a code. After that: enter the current code. Either way the API returns a verified session.
 */
export function TwoFactorForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { user, ready, signIn, signOut } = useAuth();
  const api = useApi();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [setupError, setSetupError] = useState<ClientApiError | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const requested = useRef(false);

  const settingUp = !!user && !user.twoFactor.enabled;

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace('/login');
    else if (!needsTwoFactor(user.twoFactor)) router.replace(next);
  }, [ready, user, next, router]);

  const fetchSetup = useCallback(
    () =>
      api
        .call<TwoFactorSetup>((c) => c.POST('/api/auth/2fa/setup'))
        .then(setSetup)
        .catch((err: ClientApiError) => setSetupError(err)),
    [api],
  );

  // Ask for the QR code once; repeating the call returns the same secret anyway.
  useEffect(() => {
    if (!settingUp || requested.current) return;
    requested.current = true;
    void fetchSetup();
  }, [settingUp, fetchSetup]);

  function retrySetup() {
    setSetupError(null);
    void fetchSetup();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setBusy(true);
    setError(null);
    try {
      const session = settingUp
        ? await api.call<SessionResponse>((c) => c.POST('/api/auth/2fa/enable', { body: { code } }))
        : await api.call<SessionResponse>((c) => c.POST('/api/auth/2fa/verify', { body: { code } }));
      if (await signIn(session)) {
        router.replace(next);
        return;
      }
    } catch (err) {
      setError(err as ClientApiError);
    }
    setBusy(false);
  }

  async function switchAccount() {
    await signOut();
    router.replace('/login');
  }

  if (!ready || !user || !needsTwoFactor(user.twoFactor)) {
    return (
      <div className="px-6 py-24 text-center text-muted" role="status">
        Checking your session…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <Logo tag="Admin" label="BizNexa admin home" />
        <h1 className="mt-8 text-2xl font-bold tracking-[-0.02em]">{settingUp ? 'Set up two-factor authentication' : 'Enter your security code'}</h1>
        <p className="mt-1 text-muted">
          {settingUp
            ? 'Staff accounts need a code from an authenticator app at every login. This takes about a minute.'
            : 'Open your authenticator app and enter the 6-digit code for BizNexa.'}
        </p>

        <form onSubmit={submit} noValidate className="mt-8 space-y-5 rounded-lg border border-rule bg-white p-6">
          {settingUp && (
            <ol className="space-y-5 text-sm">
              <li>
                <p className="font-semibold">1. Install an authenticator app</p>
                <p className="mt-1 text-muted">For example Google Authenticator, Microsoft Authenticator or 1Password.</p>
              </li>
              <li>
                <p className="font-semibold">2. Scan this QR code with the app</p>
                {setup ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the API */}
                    <img src={setup.qrDataUrl} alt="QR code for setting up two-factor authentication" width={180} height={180} className="mt-3 rounded border border-rule" />
                    <p className="mt-3 text-muted">Can’t scan it? Add an account in the app and type this key:</p>
                    <p className="mt-1 select-all break-all font-mono text-[15px] tracking-wider" aria-label="Setup key">
                      {groupKey(setup.secret)}
                    </p>
                  </>
                ) : setupError ? (
                  <div className="mt-3 space-y-3">
                    <Notice tone="error">{setupError.message}</Notice>
                    <Button type="button" variant="outline" size="sm" onClick={retrySetup}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-muted" role="status">
                    Loading QR code…
                  </p>
                )}
              </li>
              <li>
                <p className="font-semibold">3. Enter the 6-digit code the app shows</p>
              </li>
            </ol>
          )}

          <Field
            id="code"
            name="code"
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            autoFocus={!settingUp}
            error={error?.fieldError('code')}
          />
          {error && error.errors.length === 0 && <Notice tone="error">{error.message}</Notice>}
          <Button type="submit" variant="ink" className="w-full" disabled={busy || (settingUp && !setup)}>
            {busy ? 'Checking…' : settingUp ? 'Turn on and continue' : 'Continue'}
          </Button>
        </form>

        <button type="button" onClick={switchAccount} className="mt-4 text-sm font-medium text-ink hover:underline">
          Log out and use another account
        </button>
        {!settingUp && <p className="mt-2 text-sm text-muted">Lost your phone? Ask an admin to reset two-factor authentication for your account.</p>}
      </div>
    </div>
  );
}
