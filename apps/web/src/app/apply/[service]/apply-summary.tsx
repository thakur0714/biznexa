'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { businessEntityInput, formatINR, type BusinessEntityInput, type DraftApplication } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Icon } from '@/components/icons';
import { Breadcrumbs, Button, Notice } from '@biznexa/ui';
import type { ServiceDetail, ServicePackage } from '@/lib/api';
import { BusinessPicker, EMPTY_BUSINESS, type BusinessChoice, type SavedBusiness } from './business-picker';

/**
 * Order review before the application form: pick the business, then "Continue to your details" starts a
 * draft order + application (M3.8). The form page (M3.9), upload and payment follow in Milestone 3.
 */
export function ApplySummary({ service, pkg }: Readonly<{ service: ServiceDetail; pkg: ServicePackage }>) {
  const steps = ['Review package', 'Your details', 'Upload documents', 'Pay securely'];
  const api = useApi();
  const router = useRouter();
  const [businesses, setBusinesses] = useState<SavedBusiness[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [choice, setChoice] = useState<BusinessChoice>({ kind: 'none' });
  const [draft, setDraft] = useState<BusinessEntityInput>(EMPTY_BUSINESS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState<DraftApplication | null>(null);

  useEffect(() => {
    let live = true;
    api
      .call((c) => c.GET('/api/business-entities'))
      .then((r) => {
        if (!live) return;
        setBusinesses(r.items);
        if (r.items[0]) setChoice({ kind: 'saved', id: r.items[0].id });
      })
      .catch((e: ClientApiError) => live && setLoadError(`Could not load your businesses. ${e.message}`));
    return () => {
      live = false;
    };
  }, [api]);

  async function saveNewBusiness(): Promise<string | null> {
    const parsed = businessEntityInput.safeParse(draft);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return null;
    }
    try {
      const created = await api.call((c) => c.POST('/api/business-entities', { body: draft }));
      setBusinesses((list) => [...(list ?? []), created]);
      setChoice({ kind: 'saved', id: created.id });
      setDraft(EMPTY_BUSINESS);
      return created.id;
    } catch (e) {
      const err = e as ClientApiError;
      setFieldErrors(Object.fromEntries(err.errors.map((f) => [f.field, f.message])));
      if (!err.errors.length) setError(err.message);
      return null;
    }
  }

  async function start() {
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      let businessEntityId: string | null = null;
      if (choice.kind === 'saved') businessEntityId = choice.id;
      else if (choice.kind === 'new') businessEntityId = await saveNewBusiness();
      if (choice.kind === 'new' && !businessEntityId) return;
      const draft = await api.call<DraftApplication>((c) => c.POST('/api/applications', { body: { packageId: pkg.id, businessEntityId } }));
      setStarted(draft);
      router.push(`/apply/${service.slug}/${draft.id}`);
    } catch (e) {
      setError((e as ClientApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-[980px] px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ href: `/services/${service.category.slug}/${service.slug}`, label: service.name }, { label: 'Start application' }]} />
      <h1 className="mt-4 text-3xl font-bold tracking-[-0.025em]">Start your application</h1>

      <ol className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 ${i === 0 ? 'font-semibold text-night' : 'text-muted'}`}>
            <span className={`num grid h-6 w-6 place-items-center rounded-full text-xs ${i === 0 ? 'bg-ink text-white' : 'ring-1 ring-rule'}`}>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[1fr_320px]">
        <section className="rounded-lg border border-rule bg-white p-6">
          <p className="text-sm text-muted">{service.category.name}</p>
          <h2 className="text-xl font-semibold">
            {service.name} — {pkg.name}
          </h2>
          <ul className="mt-4 space-y-1.5 text-sm">
            {pkg.inclusions.map((i) => (
              <li key={i} className="flex gap-2">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-seal" />
                {i}
              </li>
            ))}
          </ul>
          <h3 className="mt-6 font-semibold">Keep these documents ready</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            {service.documents.map((d) => (
              <li key={d.id} className="flex gap-2">
                <Icon name="file" size={16} className="mt-0.5 shrink-0 text-ink" />
                {d.name}
              </li>
            ))}
          </ul>
          <Link href={`/services/${service.category.slug}/${service.slug}#pricing`} className="mt-6 inline-block text-sm font-medium text-ink hover:underline">
            Change package
          </Link>
          <BusinessPicker
            businesses={businesses}
            loadError={loadError}
            choice={choice}
            onChoice={(c) => {
              setChoice(c);
              setFieldErrors({});
            }}
            draft={draft}
            onDraft={setDraft}
            errors={fieldErrors}
            disabled={busy || !!started}
          />
        </section>

        <aside className="self-start rounded-lg border-2 border-night bg-white p-5">
          <h2 className="font-semibold">Order summary</h2>
          <dl className="num mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Professional fee</dt>
              <dd>{formatINR(pkg.price.professionalFee)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">GST ({pkg.gstRate}%)</dt>
              <dd>{formatINR(pkg.price.totalTax)}</dd>
            </div>
            {pkg.governmentFee > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Government fee</dt>
                <dd>{formatINR(pkg.governmentFee)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-rule pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{formatINR(pkg.price.total)}</dd>
            </div>
          </dl>
          {started ? (
            <div className="mt-5">
              <Notice tone="success">
                Application <strong className="num">{started.code}</strong> is saved as a draft (order <span className="num">{started.order.code}</span>). Taking you to your details…
              </Notice>
            </div>
          ) : (
            <>
              {error && (
                <div className="mt-5">
                  <Notice tone="error">{error}</Notice>
                </div>
              )}
              <Button variant="primary" className="mt-5 w-full" onClick={start} disabled={busy} aria-busy={busy}>
                {busy ? 'Starting your application…' : 'Continue to your details'}
              </Button>
              <p className="mt-2 text-xs text-muted">Final price with GST for your state is shown before you pay.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
