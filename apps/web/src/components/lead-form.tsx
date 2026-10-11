'use client';

import { useState } from 'react';
import { Button, Field, Notice } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';

/** "Talk to an expert" enquiry. Lands in the admin Leads list. */
export function LeadForm({ source, serviceId, compact = false, withMessage = false }: { source: 'service_page' | 'contact' | 'home' | 'consultants'; serviceId?: string; compact?: boolean; withMessage?: boolean }) {
  const api = useApi();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<ClientApiError | null>(null);
  const [done, setDone] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (name: string) => String(f.get(name) ?? '').trim() || undefined;
    setState('sending');
    setError(null);
    try {
      const body = {
        name: text('name') ?? '',
        mobile: text('mobile') ?? '',
        email: text('email'),
        city: text('city'),
        message: text('message'),
        serviceId,
        source,
      };
      const res = await api.call<{ message: string }>((c) => c.POST('/api/leads', { body }));
      setDone(res.message);
      setState('sent');
    } catch (err) {
      setError(err as ClientApiError);
      setState('idle');
    }
  }

  if (state === 'sent') return <Notice tone="success">{done}</Notice>;

  const id = (n: string) => `lead-${source}-${n}`;
  return (
    <form onSubmit={onSubmit} noValidate className={`grid gap-4 ${compact ? '' : 'sm:grid-cols-2'}`}>
      <Field id={id('name')} name="name" label="Your name" autoComplete="name" required error={error?.fieldError('name')} />
      <Field id={id('mobile')} name="mobile" label="Mobile number" inputMode="numeric" autoComplete="tel-national" maxLength={10} required error={error?.fieldError('mobile')} />
      <Field id={id('email')} name="email" label="Email (optional)" type="email" autoComplete="email" error={error?.fieldError('email')} />
      <Field id={id('city')} name="city" label="City (optional)" autoComplete="address-level2" />
      {withMessage && (
        <div className="sm:col-span-2">
          <label htmlFor={id('message')} className="mb-1.5 block text-sm font-medium">
            How can we help? (optional)
          </label>
          <textarea id={id('message')} name="message" rows={4} maxLength={1000} className="w-full rounded-md border border-rule bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink" />
        </div>
      )}
      {error && error.errors.length === 0 && (
        <div className={compact ? '' : 'sm:col-span-2'}>
          <Notice tone="error">{error.message}</Notice>
        </div>
      )}
      <div className={compact ? '' : 'sm:col-span-2'}>
        <Button type="submit" variant="ink" disabled={state === 'sending'} className="w-full sm:w-auto">
          {state === 'sending' ? 'Sending…' : 'Request a call back'}
        </Button>
        <p className="mt-2 text-xs text-muted">We use your details only to contact you about this request.</p>
      </div>
    </form>
  );
}
