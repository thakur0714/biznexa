'use client';

import { useEffect, useState } from 'react';
import type React from 'react';
import { useApi } from '@biznexa/api-client/react';
import { consultantCategories, consultantProfileInputSchema, consultationTypes, formatINR, type ConsultantOwnProfile, type ConsultantProfileInput, type ConsultationType } from '@biznexa/types';
import { Button, Field, Notice, TextArea } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';

const controlClass = 'min-h-11 w-full rounded-md border border-rule bg-white px-3 py-2 text-sm';

export function ConsultantProfileEditor() {
  const api = useApi();
  const { user } = useAuth();
  const [profile, setProfile] = useState<ConsultantOwnProfile | null>(null);
  const [form, setForm] = useState<ConsultantProfileInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!user?.roles.includes('CONSULTANT')) return;
    let cancelled = false;
    api.call<ConsultantOwnProfile>((client) => client.GET('/api/consultants/me/profile'))
      .then((result) => {
        if (cancelled) return;
        setProfile(result);
        setForm({
          category: result.category, qualification: result.qualification, membershipNo: result.membershipNo,
          experienceYears: result.experienceYears, expertise: result.expertise, languages: result.languages,
          city: result.city, state: result.state, area: result.area, bio: result.bio,
          feePerSession: result.feePerSession, consultationTypes: result.consultationTypes,
        });
        setError('');
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your profile.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, user, retry]);

  if (!user) return null;
  if (!user.roles.includes('CONSULTANT')) return <NotAllowed />;

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving) return;
    const parsed = consultantProfileInputSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the profile details.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api.call<ConsultantOwnProfile>((client) => client.PUT('/api/consultants/me/profile', { body: parsed.data }));
      setProfile(updated);
      setForm({
        category: updated.category, qualification: updated.qualification, membershipNo: updated.membershipNo,
        experienceYears: updated.experienceYears, expertise: updated.expertise, languages: updated.languages,
        city: updated.city, state: updated.state, area: updated.area, bio: updated.bio,
        feePerSession: updated.feePerSession, consultationTypes: updated.consultationTypes,
      });
      setSuccess(updated.pendingFeeRequest ? 'Profile saved. Your fee change is waiting for admin approval.' : 'Profile saved.');
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not save your profile.'); }
    finally { setSaving(false); }
  }

  const update = <K extends keyof ConsultantProfileInput>(key: K, value: ConsultantProfileInput[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const toggleType = (type: ConsultationType, checked: boolean) => setForm((current) => current ? { ...current, consultationTypes: checked ? [...current.consultationTypes, type] : current.consultationTypes.filter((item) => item !== type) } : current);

  return <main className="mx-auto max-w-4xl space-y-5" aria-labelledby="consultant-profile-heading">
    <header><h1 id="consultant-profile-heading" className="text-2xl font-semibold">My profile</h1><p className="mt-1 text-sm text-muted">Keep your public consultant profile current.</p></header>
    {error && <Notice tone="error"><div className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { setLoading(true); setError(''); setRetry((n) => n + 1); }}>Retry</Button></div></Notice>}
    {success && <Notice tone="success">{success}</Notice>}
    {loading || !profile || !form ? <p role="status">Loading your profile…</p> : <>
      {profile.pendingFeeRequest && <section className="rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="Pending fee change"><h2 className="font-semibold">Fee change awaiting approval</h2><p className="mt-1 text-sm">Your current fee is {formatINR(profile.feePerSession)}. You requested {formatINR(profile.pendingFeeRequest.requestedFee)} on {new Date(profile.pendingFeeRequest.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.</p></section>}
      <form onSubmit={save} className="space-y-5 rounded-lg border border-rule bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Category<select className={`${controlClass} mt-1`} value={form.category} disabled aria-describedby="verified-profile-fields-note">{consultantCategories.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}</select></label>
          <Field id="own-qualification" label="Qualification" value={form.qualification} disabled />
          <Field id="own-membership" label="Professional membership number" value={form.membershipNo ?? ''} disabled />
          <p id="verified-profile-fields-note" className="text-sm text-muted sm:col-span-2">Contact support to change your category, qualification or membership number.</p>
          <Field id="own-experience" label="Years of experience" type="number" min="0" max="60" value={String(form.experienceYears)} onChange={(event) => update('experienceYears', Number(event.target.value))} />
          <Field id="own-expertise" label="Expertise (comma separated)" value={form.expertise.join(', ')} onChange={(event) => update('expertise', event.target.value.split(',').map((part) => part.trim()).filter(Boolean))} />
          <Field id="own-languages" label="Languages (comma separated)" value={form.languages.join(', ')} onChange={(event) => update('languages', event.target.value.split(',').map((part) => part.trim()).filter(Boolean))} />
          <Field id="own-city" label="City" value={form.city} onChange={(event) => update('city', event.target.value)} />
          <Field id="own-state" label="State" value={form.state} onChange={(event) => update('state', event.target.value)} />
          <Field id="own-area" label="Area (optional)" value={form.area ?? ''} onChange={(event) => update('area', event.target.value || null)} />
          <Field id="own-fee" label="Fee per session (₹)" type="number" min="0.01" step="0.01" disabled={Boolean(profile.pendingFeeRequest)} value={String(form.feePerSession / 100)} onChange={(event) => update('feePerSession', Math.round(Number(event.target.value) * 100))} />
        </div>
        <TextArea id="own-bio" label="About you" value={form.bio ?? ''} onChange={(event) => update('bio', event.target.value || null)} />
        <fieldset><legend className="text-sm font-medium">Consultation types</legend><div className="mt-2 flex flex-wrap gap-x-5 gap-y-3">{consultationTypes.map((type) => <label key={type} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.consultationTypes.includes(type)} onChange={(event) => toggleType(type, event.target.checked)} />{type.toLowerCase()}</label>)}</div></fieldset>
        <Button variant="ink" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Button>
      </form>
    </>}
  </main>;
}
