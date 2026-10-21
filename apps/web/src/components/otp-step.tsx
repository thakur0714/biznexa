'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Notice } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';

export interface OtpIssued {
  expiresIn: number;
  resendAfter: number;
  devCode?: string;
}

/** Six-digit code entry with resend countdown. Calls onVerified with the API response. */
export function OtpStep<T>({
  channel,
  target,
  purpose,
  issued,
  onVerified,
  onChangeTarget,
}: Readonly<{
  channel: 'MOBILE' | 'EMAIL';
  target: string;
  purpose: 'LOGIN' | 'VERIFY_MOBILE' | 'RESET_PASSWORD';
  issued: OtpIssued;
  onVerified: (res: T) => void;
  onChangeTarget?: () => void;
}>) {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(issued.resendAfter);
  const [devCode, setDevCode] = useState(issued.devCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
    setBusy(true);
    setError('');
    try {
      onVerified(await api.call<T>((c) => c.POST('/api/auth/otp/verify', { body: { channel, target, purpose, code } })));
    } catch (err) {
      setError((err as ClientApiError).message);
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    setInfo('');
    try {
      const res = await api.call<OtpIssued>((c) => c.POST('/api/auth/otp/request', { body: { channel, target, purpose } }));
      setWait(res.resendAfter);
      setDevCode(res.devCode);
      setInfo('A new code has been sent.');
    } catch (err) {
      const e = err as ClientApiError;
      if (e.retryAfter) setWait(e.retryAfter);
      setError(e.message);
    }
  }

  const masked = channel === 'MOBILE' ? `+91 ${target.slice(0, 2)}••••${target.slice(-4)}` : target;

  return (
    <form onSubmit={verify} noValidate className="space-y-4">
      <p className="text-muted">
        Enter the 6-digit code sent to <span className="font-medium text-night">{masked}</span>.{' '}
        {onChangeTarget && (
          <button type="button" onClick={onChangeTarget} className="font-medium text-ink underline">
            Change
          </button>
        )}
      </p>
      <div>
        <label htmlFor="otp-code" className="mb-1.5 block text-sm font-medium">
          Verification code
        </label>
        <input
          ref={inputRef}
          id="otp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replaceAll(/\D/g, ''))}
          aria-invalid={!!error}
          className={`num h-14 w-full rounded-md border-2 bg-white px-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-ink ${error ? 'border-danger' : 'border-rule'}`}
        />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {info && !error && <Notice tone="success">{info}</Notice>}
      {devCode && (
        <p className="rounded-md border border-dashed border-amber/50 bg-amber-050 px-3 py-2 text-sm text-amber">
          Development mode: your code is <span className="num font-semibold">{devCode}</span>
        </p>
      )}
      <Button type="submit" variant="ink" className="w-full" disabled={busy}>
        {busy ? 'Checking…' : 'Verify code'}
      </Button>
      <p className="text-center text-sm text-muted">
        {wait > 0 ? (
          <>Resend code in <span className="num">{wait}s</span></>
        ) : (
          <button type="button" onClick={resend} className="font-medium text-ink underline">
            Resend code
          </button>
        )}
      </p>
    </form>
  );
}
