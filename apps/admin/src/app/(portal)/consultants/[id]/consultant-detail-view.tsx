'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useApi } from '@biznexa/api-client/react';
import { consultantCategories, consultationTypes, formatINR, type AdminConsultantDetail, type AdminConsultantProfileInput, type ConsultationType, type FileLinkResult } from '@biznexa/types';
import { Button, Field, Notice, TextArea } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { findNavItem, canSee } from '@/lib/nav';

const controlClass = 'min-h-10 w-full rounded border border-rule bg-white px-3 py-2 text-sm';

export function ConsultantDetailView({ id }: { id: string }) {
  const api = useApi();
  const { user } = useAuth();
  const item = findNavItem('consultants');
  const [detail, setDetail] = useState<AdminConsultantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<AdminConsultantProfileInput | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.call((client) => client.GET('/api/admin/consultants/{id}', { params: { path: { id } } }))
      .then((value) => {
        if (cancelled) return;
        setDetail(value);
        setForm({
          category: value.category, qualification: value.qualification, membershipNo: value.membershipNo,
          experienceYears: value.experienceYears, expertise: value.expertise, languages: value.languages,
          city: value.city, state: value.state, area: value.area, bio: value.bio,
          feePerSession: value.feePerSession, consultationTypes: value.consultationTypes,
        });
        setError('');
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this consultant.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, id, refreshCount]);

  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await api.call((client) => client.PATCH('/api/admin/consultants/{id}/profile', { params: { path: { id } }, body: form }));
      setSuccess('Profile saved.');
      setLoading(true);
      setRefreshCount((count) => count + 1);
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not save the profile.'); }
    finally { setSaving(false); }
  }

  async function action(actionName: 'approve' | 'reject' | 'suspend') {
    if (saving || (actionName === 'reject' && reason.trim().length < 3)) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      if (actionName === 'reject') await api.call((client) => client.POST('/api/admin/consultants/{id}/reject', { params: { path: { id } }, body: { reason: reason.trim() } }));
      else if (actionName === 'approve') await api.call((client) => client.POST('/api/admin/consultants/{id}/approve', { params: { path: { id } } }));
      else await api.call((client) => client.POST('/api/admin/consultants/{id}/suspend', { params: { path: { id } } }));
      setSuccess(`Consultant ${actionName === 'approve' ? 'approved' : actionName === 'reject' ? 'rejected' : 'suspended'}.`);
      setLoading(true);
      setRefreshCount((count) => count + 1);
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : `Could not ${actionName} this consultant.`); }
    finally { setSaving(false); }
  }

  async function openFile(fileId: string) {
    setError('');
    const tab = window.open('', '_blank');
    try {
      const link = await api.call<FileLinkResult>((client) => client.POST('/api/files/{id}/link', { params: { path: { id: fileId }, query: { disposition: 'inline' } } }));
      if (tab) { tab.opener = null; tab.location.href = link.url; }
      else window.location.assign(link.url);
    } catch (cause: unknown) { tab?.close(); setError(cause instanceof Error ? cause.message : 'Could not open this document.'); }
  }

  const update = <K extends keyof AdminConsultantProfileInput>(key: K, value: AdminConsultantProfileInput[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const toggleConsultation = (type: ConsultationType, checked: boolean) => setForm((current) => current ? { ...current, consultationTypes: checked ? [...current.consultationTypes, type] : current.consultationTypes.filter((itemType) => itemType !== type) } : current);

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <Link href="/consultants" className="text-sm font-medium underline">← Consultant applications</Link>
      {error && <Notice tone="error">{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
      {loading || !detail || !form ? <p role="status">Loading consultant review…</p> : <>
        <header><h1 className="text-2xl font-semibold">{detail.name}</h1><p className="mt-1 text-sm text-muted">{detail.email} · {detail.verificationStatus} · {detail.category.replaceAll('_', ' ')} · {formatINR(detail.feePerSession)} per session</p></header>
        <section className="space-y-3 rounded-lg border border-rule bg-white p-4" aria-labelledby="consultant-documents-heading">
          <h2 id="consultant-documents-heading" className="text-lg font-semibold">Verification documents</h2>
          {detail.documents.length ? <ul className="divide-y divide-rule">{detail.documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"><div><p className="font-medium">{document.kind.replaceAll('_', ' ')}</p><p className="text-sm text-muted">{document.fileName} · {document.scanStatus}</p></div><Button variant="outline" disabled={document.scanStatus !== 'CLEAN'} onClick={() => void openFile(document.fileId)}>Open</Button></li>)}</ul> : <p className="text-sm text-muted">No verification documents uploaded.</p>}
        </section>
        <form onSubmit={saveProfile} className="space-y-4 rounded-lg border border-rule bg-white p-4">
          <h2 className="text-lg font-semibold">Profile details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">Category<select className={controlClass} value={form.category} onChange={(event) => { const value = consultantCategories.find((candidate) => candidate === event.target.value); if (value) update('category', value); }}>{consultantCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
            <Field id="consultant-qualification" label="Qualification" value={form.qualification} onChange={(event) => update('qualification', event.target.value)} />
            <Field id="consultant-membership" label="Membership number" value={form.membershipNo ?? ''} onChange={(event) => update('membershipNo', event.target.value || null)} />
            <Field id="consultant-experience" label="Experience years" type="number" min="0" value={String(form.experienceYears)} onChange={(event) => update('experienceYears', Number(event.target.value))} />
            <Field id="consultant-expertise" label="Expertise (comma separated)" value={form.expertise.join(', ')} onChange={(event) => update('expertise', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} />
            <Field id="consultant-languages" label="Languages (comma separated)" value={form.languages.join(', ')} onChange={(event) => update('languages', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} />
            <Field id="consultant-city" label="City" value={form.city} onChange={(event) => update('city', event.target.value)} />
            <Field id="consultant-state" label="State" value={form.state} onChange={(event) => update('state', event.target.value)} />
            <Field id="consultant-area" label="Area" value={form.area ?? ''} onChange={(event) => update('area', event.target.value || null)} />
            <Field id="consultant-fee" label="Fee per session (₹)" type="number" min="0.01" step="0.01" value={String(form.feePerSession / 100)} onChange={(event) => update('feePerSession', Math.round(Number(event.target.value) * 100))} />
          </div>
          <TextArea id="consultant-bio" label="Bio" value={form.bio ?? ''} onChange={(event) => update('bio', event.target.value || null)} />
          <fieldset><legend className="text-sm font-medium">Consultation types</legend><div className="mt-2 flex flex-wrap gap-4">{consultationTypes.map((type) => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.consultationTypes.includes(type)} onChange={(event) => toggleConsultation(type, event.target.checked)} />{type}</label>)}</div></fieldset>
          <Button variant="ink" type="submit" disabled={saving}>Save profile</Button>
        </form>
        <section className="space-y-3 rounded-lg border border-rule bg-white p-4" aria-labelledby="consultant-decision-heading">
          <h2 id="consultant-decision-heading" className="text-lg font-semibold">Review decision</h2>
          {detail.rejectionReason && <p className="text-sm text-danger">Previous rejection reason: {detail.rejectionReason}</p>}
          <div className="flex flex-wrap gap-2"><Button variant="ink" disabled={saving} onClick={() => void action('approve')}>Approve</Button><Button variant="outline" disabled={saving} onClick={() => void action('suspend')}>Suspend</Button></div>
          <label className="block text-sm font-medium">Rejection reason<textarea className={`${controlClass} mt-1 min-h-20`} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <Button variant="outline" disabled={saving || reason.trim().length < 3} onClick={() => void action('reject')}>Reject application</Button>
        </section>
      </>}
    </main>
  );
}
