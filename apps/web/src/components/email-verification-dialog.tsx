'use client';

import { useState } from 'react';
import { Button, Dialog, Field, Notice } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { useAuth } from '@/lib/auth';

export function EmailVerificationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function requestCode() {
    setBusy(true); setError(''); setSuccess('');
    setSent(true);
    try {
      await api.call((c) => c.POST('/api/auth/email/verify/request'));
      setSent(true);
      setSuccess('A verification code was sent to your email address.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send a verification code.'); }
    finally { setBusy(false); }
  }

  async function confirmCode() {
    setBusy(true); setError(''); setSuccess('');
    try {
      await api.call((c) => c.POST('/api/auth/email/verify/confirm', { body: { code } }));
      await refresh();
      setSuccess('Email verified.');
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'That code could not be verified.'); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onClose={onClose} title="Verify your email" description="Enter the six-digit code sent to your email address." footer={<>
    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
    <Button type="button" variant="outline" onClick={requestCode} disabled={busy}>{busy ? 'Sending…' : sent ? 'Send new code' : 'Send code'}</Button>
    <Button type="button" onClick={confirmCode} disabled={busy || !/^\d{6}$/.test(code)}>{busy ? 'Verifying…' : 'Verify email'}</Button>
  </>}>
    {error && <Notice tone="error">{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <Field id="email-verification-code" label="Verification code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
  </Dialog>;
}
