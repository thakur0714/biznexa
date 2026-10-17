'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Button, Container, Notice } from '@biznexa/ui';
import {
  consultantApplicationInputSchema,
  consultantCategories,
  consultantProfileInputSchema,
  consultationTypes,
  type ConsultantApplicationResponse,
  type ConsultantCategory,
  type ConsultationType,
  type StoredFileResult,
} from '@biznexa/types';
import { useAuth } from '@/lib/auth';

type DocumentKey = 'qualificationProof' | 'membershipProof' | 'idProof';
type FormState = {
  category: ConsultantCategory;
  qualification: string;
  membershipNo: string;
  experienceYears: string;
  expertise: string;
  languages: string;
  city: string;
  state: string;
  area: string;
  bio: string;
  feeRupees: string;
};

const initialForm: FormState = {
  category: 'CA',
  qualification: '',
  membershipNo: '',
  experienceYears: '0',
  expertise: '',
  languages: '',
  city: '',
  state: '',
  area: '',
  bio: '',
  feeRupees: '',
};

const documentLabels: Record<DocumentKey, string> = {
  qualificationProof: 'Qualification proof',
  membershipProof: 'Membership proof',
  idProof: 'Identity proof',
};
const documentKeys: DocumentKey[] = ['qualificationProof', 'membershipProof', 'idProof'];

const consultationLabels: Record<ConsultationType, string> = {
  AUDIO: 'Audio',
  VIDEO: 'Video',
  CHAT: 'Chat',
  MEETING: 'Online meeting',
};

const controlClass = 'mt-1 min-h-11 w-full rounded-md border border-rule bg-white px-3 py-2 text-base text-night focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function ConsultantApplicationForm() {
  const { user, ready } = useAuth();
  const api = useApi();
  const [form, setForm] = useState<FormState>(initialForm);
  const [files, setFiles] = useState<Record<DocumentKey, File | null>>({ qualificationProof: null, membershipProof: null, idProof: null });
  const [selectedTypes, setSelectedTypes] = useState<ConsultationType[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<ConsultantApplicationResponse | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusyMessage('Checking your application…');

    const feeRupees = Number(form.feeRupees);
    const parsedProfile = consultantProfileInputSchema.safeParse({
      category: form.category,
      qualification: form.qualification,
      membershipNo: form.membershipNo.trim() || null,
      experienceYears: Number(form.experienceYears),
      expertise: splitList(form.expertise),
      languages: splitList(form.languages),
      city: form.city,
      state: form.state,
      area: form.area.trim() || null,
      bio: form.bio.trim() || null,
      feePerSession: Number.isFinite(feeRupees) ? Math.round(feeRupees * 100) : 0,
      consultationTypes: selectedTypes,
    });
    if (!parsedProfile.success) {
      setError(parsedProfile.error.issues[0]?.message ?? 'Check the application details and try again.');
      setBusyMessage('');
      return;
    }
    if (!files.qualificationProof || !files.membershipProof || !files.idProof) {
      setError('Upload qualification proof, membership proof and identity proof.');
      setBusyMessage('');
      return;
    }

    setBusy(true);
    try {
      const documents: Record<DocumentKey, string> = { qualificationProof: '', membershipProof: '', idProof: '' };
      for (const key of documentKeys) {
        const file = files[key];
        if (!file) throw new Error(`Upload ${documentLabels[key].toLowerCase()}.`);
        setBusyMessage(`Uploading ${documentLabels[key].toLowerCase()}…`);
        const body = new FormData();
        body.append('file', file);
        const stored = await api.call<StoredFileResult>((client) => client.POST('/api/files', {
          body: { file: file.name },
          bodySerializer: () => body,
        }));
        documents[key] = stored.id;
      }

      setBusyMessage('Submitting your application…');
      const input = consultantApplicationInputSchema.parse({
        ...parsedProfile.data,
        documents: {
          qualificationProofId: documents.qualificationProof,
          membershipProofId: documents.membershipProof,
          idProofId: documents.idProof,
        },
      });
      const result = await api.call<ConsultantApplicationResponse>((client) => client.POST('/api/consultants', { body: input }));
      setSubmitted(result);
    } catch (cause: unknown) {
      setError(cause instanceof ClientApiError ? cause.message : cause instanceof Error ? cause.message : 'We couldn’t submit your application. Please try again.');
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  }

  if (!ready) {
    return <Container className="py-12"><p role="status">Loading your account…</p></Container>;
  }
  if (!user) {
    return (
      <Container className="max-w-2xl py-12">
        <h1 className="text-3xl font-bold tracking-[-0.025em]">Apply as a consultant</h1>
        <p className="mt-3 text-muted">Sign in to complete your consultant application.</p>
        <Link href="/login?next=%2Fconsultants%2Fapply" className="mt-5 inline-flex min-h-11 items-center rounded-md bg-ink px-4 font-semibold text-white">Sign in</Link>
      </Container>
    );
  }
  if (submitted) {
    return (
      <Container className="max-w-2xl py-12">
        <Notice tone="success">Your application is submitted and awaiting review.</Notice>
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.025em]">Application received</h1>
        <p className="mt-2 text-muted">We’ll review your profile and documents. Your application status is {submitted.verificationStatus.toLowerCase()}.</p>
        <Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center rounded-md border border-rule px-4 font-semibold text-night hover:bg-paper">Go to dashboard</Link>
      </Container>
    );
  }

  return (
    <Container className="max-w-3xl py-8 sm:py-12">
      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-[-0.025em] sm:text-4xl">Apply as a consultant</h1>
        <p className="mt-2 text-muted">Share your credentials and consultation details. Our team will verify your application before your profile goes live.</p>
      </div>
      {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
      <form onSubmit={submit} className="space-y-7" aria-busy={busy}>
        <fieldset disabled={busy} className="space-y-5 rounded-xl border border-rule bg-white p-4 sm:p-6">
          <legend className="px-2 text-lg font-semibold">Professional profile</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Professional category
              <select className={controlClass} value={form.category} onChange={(event) => {
                const value = consultantCategories.find((category) => category === event.target.value);
                if (value) update('category', value);
              }}>
                {consultantCategories.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Qualification
              <input className={controlClass} value={form.qualification} onChange={(event) => update('qualification', event.target.value)} required maxLength={120} />
            </label>
            <label className="text-sm font-medium">Membership number (ICAI / ICSI / Bar Council)
              <input className={controlClass} value={form.membershipNo} onChange={(event) => update('membershipNo', event.target.value)} maxLength={80} />
            </label>
            <label className="text-sm font-medium">Years of experience
              <input className={controlClass} type="number" min="0" max="60" step="1" value={form.experienceYears} onChange={(event) => update('experienceYears', event.target.value)} required />
            </label>
            <label className="text-sm font-medium">Expertise (comma separated)
              <input className={controlClass} value={form.expertise} onChange={(event) => update('expertise', event.target.value)} placeholder="GST, company law" required />
            </label>
            <label className="text-sm font-medium">Languages (comma separated)
              <input className={controlClass} value={form.languages} onChange={(event) => update('languages', event.target.value)} placeholder="English, Hindi" required />
            </label>
            <label className="text-sm font-medium">City
              <input className={controlClass} value={form.city} onChange={(event) => update('city', event.target.value)} required maxLength={100} />
            </label>
            <label className="text-sm font-medium">State
              <input className={controlClass} value={form.state} onChange={(event) => update('state', event.target.value)} required maxLength={100} />
            </label>
            <label className="text-sm font-medium">Area / locality (optional)
              <input className={controlClass} value={form.area} onChange={(event) => update('area', event.target.value)} maxLength={120} />
            </label>
            <label className="text-sm font-medium">Fee per session (₹)
              <input className={controlClass} type="number" min="0.01" step="0.01" value={form.feeRupees} onChange={(event) => update('feeRupees', event.target.value)} required />
            </label>
          </div>
          <label className="block text-sm font-medium">Short professional bio (optional)
            <textarea className={`${controlClass} min-h-28`} value={form.bio} onChange={(event) => update('bio', event.target.value)} maxLength={2000} />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Consultation types</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {consultationTypes.map((type) => (
                <label key={type} className="flex min-h-11 items-center gap-2 rounded-md border border-rule px-3 text-sm">
                  <input type="checkbox" checked={selectedTypes.includes(type)} onChange={(event) => setSelectedTypes((current) => event.target.checked ? [...current, type] : current.filter((item) => item !== type))} />
                  {consultationLabels[type]}
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>

        <fieldset disabled={busy} className="space-y-4 rounded-xl border border-rule bg-white p-4 sm:p-6">
          <legend className="px-2 text-lg font-semibold">Proof documents</legend>
          <p className="text-sm text-muted">Upload a PDF, JPG or PNG for each document. Maximum 10 MB per file.</p>
          {documentKeys.map((key) => (
            <label key={key} className="block text-sm font-medium">
              {documentLabels[key]} <span className="text-danger" aria-hidden="true">*</span>
              <input className="mt-2 block min-h-11 w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border-0 file:bg-paper file:px-3 file:font-medium" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required onChange={(event) => setFiles((current) => ({ ...current, [key]: event.target.files?.[0] ?? null }))} />
              {files[key] && <span className="mt-1 block break-all text-xs text-muted">Selected: {files[key]?.name}</span>}
            </label>
          ))}
        </fieldset>

        {busyMessage && <p role="status" className="text-sm text-muted">{busyMessage}</p>}
        <Button type="submit" variant="ink" disabled={busy} className="w-full sm:w-auto">{busy ? 'Submitting…' : 'Submit application'}</Button>
      </form>
    </Container>
  );
}
