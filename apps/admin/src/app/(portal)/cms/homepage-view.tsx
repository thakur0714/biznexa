'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Field, Notice, useToast } from '@biznexa/ui';
import { PERMS } from '@biznexa/types';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { RichTextEditor } from '@/components/rich-text-editor';
import { useAuth } from '@/lib/auth';

type Banner = { id?: string; title: string; subtitle: string | null; imageUrl: string | null; linkUrl: string | null; sortOrder: number; isActive: boolean };
type Testimonial = { id?: string; name: string; company: string | null; quote: string; rating: number; sortOrder: number; isActive: boolean };
type Stat = { label: string; value: string; sortOrder: number; isActive: boolean };
type FAQ = { question: string; answer: string; sortOrder: number; isActive: boolean };
type Home = { banners: Banner[]; testimonials: Testimonial[]; stats: Stat[]; popularServiceIds: string[]; faq: FAQ[] };
type ServiceOption = { id: string; name: string };
const blank: Home = { banners: [], testimonials: [], stats: [], popularServiceIds: [], faq: [] };

export function HomepageCmsView() {
  const { user } = useAuth(); const api = useApi(); const toast = useToast();
  const [value, setValue] = useState<Home>(blank); const [services, setServices] = useState<ServiceOption[]>([]); const [error, setError] = useState(''); const [ready, setReady] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.call<Home>((c) => c.GET('/api/admin/cms/homepage')),
      api.call<ServiceOption[]>((c) => c.GET('/api/admin/cms/homepage/services')),
    ]).then(([home, catalogue]) => { if (alive) { setValue({ ...blank, ...home }); setServices(catalogue ?? []); setReady(true); } }).catch((e: Error) => { if (alive) { setError(e.message); setReady(true); } });
    return () => { alive = false; };
  }, [api]);
  if (!user?.permissions.includes(PERMS.CMS_MANAGE)) return <NotAllowed />;
  const setRow = <K extends keyof Home>(key: K, index: number, row: Home[K] extends Array<infer T> ? T : never) => setValue((v) => ({ ...v, [key]: v[key].map((x, i) => i === index ? row : x) }));
  const reorder = (key: 'banners' | 'testimonials' | 'stats' | 'faq', index: number, delta: number) => setValue((v) => {
    const rows = [...v[key]];
    const target = index + delta;
    if (target < 0 || target >= rows.length) return v;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    return { ...v, [key]: rows.map((row, sortOrder) => ({ ...row, sortOrder })) };
  });
  const remove = (key: 'banners' | 'testimonials' | 'stats' | 'faq', index: number) => setValue((v) => ({ ...v, [key]: v[key].filter((_, i) => i !== index) }));
  const add = (key: 'banners' | 'testimonials' | 'stats' | 'faq') => setValue((v) => ({ ...v, banners: key === 'banners' ? [...v.banners, { title: '', subtitle: null, imageUrl: null, linkUrl: null, sortOrder: v.banners.length, isActive: true }] : v.banners, testimonials: key === 'testimonials' ? [...v.testimonials, { name: '', company: null, quote: '', rating: 5, sortOrder: v.testimonials.length, isActive: true }] : v.testimonials, stats: key === 'stats' ? [...v.stats, { label: '', value: '', sortOrder: v.stats.length, isActive: true }] : v.stats, faq: key === 'faq' ? [...v.faq, { question: '', answer: '', sortOrder: v.faq.length, isActive: true }] : v.faq }));
  async function save() { setSaving(true); setError(''); try { const saved = await api.call<Home>((c) => c.PUT('/api/admin/cms/homepage', { body: value })); setValue({ ...blank, ...saved }); toast('Homepage content saved', 'success'); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }
  return <div className="max-w-5xl space-y-7"><div><h1 className="text-2xl font-bold">Homepage content</h1><p className="mt-1 text-muted">Manage banners, testimonials, counters, real catalogue services and FAQs. <Link className="underline" href="/cms">Edit website pages</Link></p></div>
    {error && <Notice tone="error">{error}</Notice>}{!ready && <p role="status">Loading homepage content…</p>}
    <section className="space-y-4"><h2 className="text-xl font-semibold">Banners</h2>{value.banners.map((b, i) => <fieldset key={b.id ?? i} className="grid gap-3 rounded-lg border border-rule bg-white p-4 sm:grid-cols-2"><legend className="px-1">Banner {i + 1}</legend><Field label="Title" id={`banner-title-${i}`} value={b.title} onChange={(e) => setRow('banners', i, { ...b, title: e.target.value })} /><Field label="Subtitle" id={`banner-subtitle-${i}`} value={b.subtitle ?? ''} onChange={(e) => setRow('banners', i, { ...b, subtitle: e.target.value || null })} /><Field label="Image URL from the editor upload" id={`banner-image-${i}`} value={b.imageUrl ?? ''} onChange={(e) => setRow('banners', i, { ...b, imageUrl: e.target.value || null })} /><Field label="Link URL" id={`banner-link-${i}`} value={b.linkUrl ?? ''} onChange={(e) => setRow('banners', i, { ...b, linkUrl: e.target.value || null })} /><label className="flex items-center gap-2"><input type="checkbox" checked={b.isActive} onChange={(e) => setRow('banners', i, { ...b, isActive: e.target.checked })} />Active</label><Button variant="outline" size="sm" onClick={() => reorder('banners', i, -1)} aria-label="Move up">↑</Button><Button variant="outline" size="sm" onClick={() => reorder('banners', i, 1)} aria-label="Move down">↓</Button><Button variant="outline" size="sm" onClick={() => remove('banners', i)}>Remove</Button></fieldset>)}<Button variant="outline" onClick={() => add('banners')}>Add banner</Button></section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Testimonials</h2>{value.testimonials.map((t, i) => <fieldset key={t.id ?? i} className="grid gap-3 rounded-lg border border-rule bg-white p-4 sm:grid-cols-2"><legend className="px-1">Testimonial {i + 1}</legend><Field label="Name" id={`testimonial-name-${i}`} value={t.name} onChange={(e) => setRow('testimonials', i, { ...t, name: e.target.value })} /><Field label="Company" id={`testimonial-company-${i}`} value={t.company ?? ''} onChange={(e) => setRow('testimonials', i, { ...t, company: e.target.value || null })} /><Field label="Quote" id={`testimonial-quote-${i}`} value={t.quote} onChange={(e) => setRow('testimonials', i, { ...t, quote: e.target.value })} /><Field type="number" label="Rating (1–5)" id={`testimonial-rating-${i}`} value={String(t.rating)} onChange={(e) => setRow('testimonials', i, { ...t, rating: Number(e.target.value) })} /><label className="flex items-center gap-2"><input type="checkbox" checked={t.isActive} onChange={(e) => setRow('testimonials', i, { ...t, isActive: e.target.checked })} />Active</label><Button variant="outline" size="sm" onClick={() => reorder('testimonials', i, -1)} aria-label="Move up">↑</Button><Button variant="outline" size="sm" onClick={() => reorder('testimonials', i, 1)} aria-label="Move down">↓</Button><Button variant="outline" size="sm" onClick={() => remove('testimonials', i)}>Remove</Button></fieldset>)}<Button variant="outline" onClick={() => add('testimonials')}>Add testimonial</Button></section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Counters</h2>{value.stats.map((s, i) => <div key={i} className="grid gap-3 rounded-lg border border-rule bg-white p-4 sm:grid-cols-3"><Field label="Label" id={`stat-label-${i}`} value={s.label} onChange={(e) => setRow('stats', i, { ...s, label: e.target.value })} /><Field label="Value" id={`stat-value-${i}`} value={s.value} onChange={(e) => setRow('stats', i, { ...s, value: e.target.value })} /><label className="flex items-center gap-2"><input type="checkbox" checked={s.isActive} onChange={(e) => setRow('stats', i, { ...s, isActive: e.target.checked })} />Active</label><Button variant="outline" size="sm" onClick={() => reorder('stats', i, -1)} aria-label="Move up">↑</Button><Button variant="outline" size="sm" onClick={() => reorder('stats', i, 1)} aria-label="Move down">↓</Button><Button variant="outline" size="sm" onClick={() => remove('stats', i)}>Remove</Button></div>)}<Button variant="outline" onClick={() => add('stats')}>Add counter</Button></section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Popular services</h2><p className="text-sm text-muted">Choose up to eight active services from the catalogue.</p><div className="grid gap-2 sm:grid-cols-2">{services.map((s) => <label key={s.id} className="flex items-center gap-2 rounded border border-rule bg-white p-3"><input type="checkbox" checked={value.popularServiceIds.includes(s.id)} disabled={!value.popularServiceIds.includes(s.id) && value.popularServiceIds.length >= 8} onChange={(e) => setValue((v) => ({ ...v, popularServiceIds: e.target.checked ? [...v.popularServiceIds, s.id] : v.popularServiceIds.filter((id) => id !== s.id) }))} />{s.name}</label>)}</div></section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Frequently asked questions</h2>{value.faq.map((f, i) => <fieldset key={i} className="space-y-4 rounded-lg border border-rule bg-white p-4"><legend className="px-1">Question {i + 1}</legend><Field label="Question" id={`faq-question-${i}`} value={f.question} onChange={(e) => setRow('faq', i, { ...f, question: e.target.value })} /><RichTextEditor id={`faq-answer-${i}`} label="Answer" value={f.answer} onChange={(answer) => setRow('faq', i, { ...f, answer })} /><label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setRow('faq', i, { ...f, isActive: e.target.checked })} />Active</label><Button variant="outline" size="sm" onClick={() => reorder('faq', i, -1)} aria-label="Move up">↑</Button><Button variant="outline" size="sm" onClick={() => reorder('faq', i, 1)} aria-label="Move down">↓</Button><Button variant="outline" size="sm" onClick={() => remove('faq', i)}>Remove</Button></fieldset>)}<Button variant="outline" onClick={() => add('faq')}>Add FAQ</Button></section>
    <Button disabled={saving || !ready} onClick={save}>{saving ? 'Saving…' : 'Save homepage'}</Button>
  </div>;
}
