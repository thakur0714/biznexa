'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { OPTION_SOURCES, PERMS, formatDate, type RejectionPresets, type MobileVersion } from '@biznexa/types';
import { Button, LinkButton, Field, Notice, Select, useToast } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { StaffUsersPage } from './staff-users-page';
import { canSee, findNavItem } from '@/lib/nav';
import { formFieldOf, sellerFormErrors, toSellerForm, toSellerRequest, type SavedSellerSettings, type SellerFormField, type SellerFormValues } from './seller-form';

/** Settings (M3.14): the seller details used for GST place of supply and printed on invoices. */
export function SettingsView() {
  const { user } = useAuth();
  const item = findNavItem('settings');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  const canManageSettings = user.permissions.includes(PERMS.SETTINGS_MANAGE);
  return (
    <div className="space-y-12">
      {canManageSettings && <SellerSettingsPage />}
      {canManageSettings && <RejectionPresetsPage />}
      {canManageSettings && <MobileVersionPage />}
      {user.permissions.includes(PERMS.USERS_MANAGE) && <StaffUsersPage />}
      {canManageSettings && <div className="max-w-[800px] rounded-lg border border-rule bg-white p-6 shadow-xs">
        <h2 className="text-xl font-bold tracking-[-0.02em] text-night">Notification Templates</h2>
        <p className="mt-1 text-sm text-muted">
          Manage transactional message templates, DLT template IDs, and preview rendered notifications across email, SMS, push, and in-app channels.
        </p>
        <div className="mt-4">
          <LinkButton href="/notifications" variant="outline" size="sm">
            Open Notification Template Editor →
          </LinkButton>
        </div>
      </div>}
    </div>
  );
}

type Errors = Partial<Record<SellerFormField, string>>;

function SellerSettingsPage() {
  const api = useApi();
  const toast = useToast();
  const [saved, setSaved] = useState<SavedSellerSettings | null>(null);
  const [values, setValues] = useState<SellerFormValues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/settings/seller')).then(
      (s) => {
        if (cancelled) return;
        setSaved(s);
        setValues(toSellerForm(s));
        setLoadError(null);
      },
      (err: Error) => !cancelled && setLoadError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, reload]);

  const set = (key: SellerFormField, value: string) => {
    setValues((v) => v && { ...v, [key]: value });
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    const found = sellerFormErrors(values);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const s = await api.call((c) => c.PUT('/api/admin/settings/seller', { body: toSellerRequest(values) }));
      setSaved(s);
      setValues(toSellerForm(s));
      toast('Seller details saved', 'success');
    } catch (err) {
      if (err instanceof ClientApiError && err.errors.length) {
        setErrors(Object.fromEntries(err.errors.map((x) => [formFieldOf(x.field), x.message])));
      } else setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const field = (key: SellerFormField, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) =>
    values && <Field id={`seller-${key}`} label={label} value={values[key]} onChange={(e) => set(key, e.target.value)} error={errors[key]} {...extra} />;

  return (
    <div className="max-w-[800px]">
      <h1 className="text-2xl font-bold tracking-[-0.02em]">Settings</h1>
      <p className="mt-1 text-muted">Seller details for GST and invoices.</p>

      <div className="mt-6">
        {loadError ? (
          <div className="space-y-3">
            <Notice tone="error">{loadError}</Notice>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !values ? (
          <p className="text-muted" role="status">
            Loading settings…
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-6">
            {formError && <Notice tone="error">{formError}</Notice>}
            {!saved?.address && (
              <Notice tone="info">
                The registered address is not set yet. Invoices need it, and GST is worked out from its state
                {saved?.state ? ` (currently ${saved.state})` : ' — until it is set, every order is charged IGST'}.
              </Notice>
            )}

            <fieldset className="grid gap-4 rounded-md border border-rule bg-white p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold text-night">Business</legend>
              {field('name', 'Brand name', { hint: 'Shown on the website and emails.', autoComplete: 'organization' })}
              {field('legalName', 'Legal name', { hint: 'As registered; printed on invoices.' })}
              {field('gstin', 'GSTIN', {
                hint: 'Leave blank if not registered. Must be registered in the state of the address.',
                autoComplete: 'off',
                onChange: (e) => set('gstin', e.target.value.toUpperCase()),
              })}
              {field('email', 'Billing email', { type: 'email', inputMode: 'email', autoComplete: 'email' })}
              {field('phone', 'Phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
            </fieldset>

            <fieldset className="grid gap-4 rounded-md border border-rule bg-white p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold text-night">Registered address</legend>
              {field('line1', 'Address line 1', { className: 'sm:col-span-2', autoComplete: 'address-line1' })}
              {field('line2', 'Address line 2 (optional)', { className: 'sm:col-span-2', autoComplete: 'address-line2' })}
              {field('city', 'City', { autoComplete: 'address-level2' })}
              <Select
                id="seller-state"
                label="State"
                value={values.state}
                onChange={(e) => set('state', e.target.value)}
                error={errors.state}
                hint="Orders from this state pay CGST + SGST; others pay IGST."
              >
                <option value="">Choose the state</option>
                {OPTION_SOURCES.states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
              {field('pincode', 'PIN code', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 6 })}
            </fieldset>

            <fieldset className="grid gap-4 rounded-md border border-rule bg-white p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold text-night">Invoices</legend>
              {field('invoicePrefix', 'Invoice number prefix', {
                hint: `Up to 4 letters or digits, e.g. ${values.invoicePrefix || 'BN'}/2627/000123 (GST allows 16 characters). Change it only at the start of a financial year.`,
                autoComplete: 'off',
                onChange: (e) => set('invoicePrefix', e.target.value.toUpperCase()),
              })}
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ink" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save details'}
              </Button>
              {saved?.updatedAt && <span className="text-sm text-muted">Last changed {formatDate(saved.updatedAt)}</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}


function RejectionPresetsPage() {
  const api = useApi();
  const toast = useToast();
  const [saved, setSaved] = useState<RejectionPresets | null>(null);
  const [presets, setPresets] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/settings/rejection-presets')).then(
      (s) => {
        if (cancelled) return;
        setSaved(s);
        setPresets(s.presets);
        setLoadError(null);
      },
      (err: Error) => !cancelled && setLoadError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, reload]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = presets.map((p) => p.trim()).filter(Boolean);
    if (new Set(clean).size !== clean.length) {
      setFormError('Presets must be unique');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const s = await api.call((c) => c.PUT('/api/admin/settings/rejection-presets', { body: clean }));
      setSaved(s);
      setPresets(s.presets);
      toast('Rejection presets saved', 'success');
    } catch (err) {
      if (err instanceof ClientApiError && err.errors.length) {
        setFormError(err.errors[0].message);
      } else setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[800px]">
      <h2 className="text-xl font-bold tracking-[-0.02em]">Rejection Presets</h2>
      <p className="mt-1 text-muted">Reasons for rejecting a document.</p>

      <div className="mt-6">
        {loadError ? (
          <div className="space-y-3">
            <Notice tone="error">{loadError}</Notice>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !saved ? (
          <p className="text-muted" role="status">
            Loading presets…
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-6">
            {formError && <Notice tone="error">{formError}</Notice>}

            <fieldset className="grid gap-4 rounded-md border border-rule bg-white p-4">
              <legend className="px-1 text-sm font-semibold text-night">Presets</legend>
              {presets.map((preset, i) => (
                <div key={i} className="flex gap-2">
                  <Field
                    id={`preset-${i}`}
                    label={`Preset ${i + 1}`}
                    value={preset}
                    onChange={(e) => {
                      const newPresets = [...presets];
                      newPresets[i] = e.target.value;
                      setPresets(newPresets);
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-6"
                    onClick={() => setPresets(presets.filter((_, index) => index !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setPresets([...presets, ''])}>
                Add Preset
              </Button>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ink" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save presets'}
              </Button>
              {saved?.updatedAt && <span className="text-sm text-muted">Last changed {formatDate(saved.updatedAt)}</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function MobileVersionPage() {
  const api = useApi();
  const toast = useToast();
  const [saved, setSaved] = useState<MobileVersion | null>(null);
  const [version, setVersion] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/settings/mobile-version')).then(
      (s) => {
        if (cancelled) return;
        setSaved(s);
        setVersion(s.minSupportedVersion);
        setLoadError(null);
      },
      (err: Error) => !cancelled && setLoadError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, reload]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const s = await api.call((c) => c.PUT('/api/admin/settings/mobile-version', { body: { minSupportedVersion: version } }));
      setSaved(s);
      setVersion(s.minSupportedVersion);
      toast('Mobile app version saved', 'success');
    } catch (err) {
      if (err instanceof ClientApiError && err.errors.length) {
        setFormError(err.errors[0].message);
      } else setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[800px]">
      <h2 className="text-xl font-bold tracking-[-0.02em]">Mobile app</h2>
      <p className="mt-1 text-muted">Older app versions will be asked to update.</p>

      <div className="mt-6">
        {loadError ? (
          <div className="space-y-3">
            <Notice tone="error">{loadError}</Notice>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !saved ? (
          <p className="text-muted" role="status">
            Loading settings…
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-6">
            {formError && <Notice tone="error">{formError}</Notice>}
            <div className="flex gap-4 items-end">
              <Field id="mobile-version" label="Minimum supported version" value={version} onChange={(e) => setVersion(e.target.value)} />
              <Button variant="ink" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
            {saved?.updatedAt && <span className="text-sm text-muted">Last changed {formatDate(saved.updatedAt)}</span>}
          </form>
        )}
      </div>
    </div>

  );
}
