'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Field, Notice, Select, useToast } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import type { components } from '@biznexa/api-client';
import { PERMS } from '@biznexa/types';
import { NotAllowed } from '@/components/portal-shell';
import { RichTextEditor } from '@/components/rich-text-editor';
import { useAuth } from '@/lib/auth';

type CmsPageResponse = components['schemas']['CmsPage'];
type Block = Extract<CmsPageResponse['content'], { blocks: unknown[] }>['blocks'][number];
const slugs = ['about', 'terms', 'privacy', 'refund-policy', 'contact'] as const;
type PageSlug = (typeof slugs)[number];
type Page = Omit<CmsPageResponse, 'id' | 'updatedAt'> & Partial<Pick<CmsPageResponse, 'id' | 'updatedAt'>>;
const titles: Record<PageSlug, string> = { about: 'About', terms: 'Terms', privacy: 'Privacy', 'refund-policy': 'Refund', contact: 'Contact' };
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function htmlFromLegacy(blocks: Block[] = []) {
  return blocks.map((block) => block.type === 'heading'
    ? `<h2>${escapeHtml(block.text ?? '')}</h2>`
    : block.type === 'list'
      ? `<ul>${(block.items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : `<p>${escapeHtml(block.text ?? '')}</p>`).join('');
}
function contentHtml(content: CmsPageResponse['content'] | CmsPageResponse['draftContent']): string {
  if (!content) return '';
  return 'html' in content ? content.html : htmlFromLegacy(content.blocks);
}

export function CmsView() {
  const { user } = useAuth();
  const api = useApi();
  const toast = useToast();
  const [pages, setPages] = useState<Page[]>([]);
  const [slug, setSlug] = useState<PageSlug>(slugs[0]);
  const [form, setForm] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const page = pages.find((p) => p.slug === slug);
  const hasUnpublishedChanges = page?.status === 'PUBLISHED' && page.draftTitle !== null && page.draftTitle !== undefined;

  useEffect(() => {
    let alive = true;
    api.call<CmsPageResponse[]>((c) => c.GET('/api/admin/cms/pages')).then((rows) => { if (alive) { const loaded = rows ?? []; setPages(loaded); const selected = loaded.find((p) => p.slug === slug); setForm(selected ? editable(selected) : { slug, title: titles[slug], content: { html: '' }, seoTitle: null, metaDescription: null, ogImageUrl: null, contactEmail: null, contactPhone: null, status: 'DRAFT' }); } }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [api, slug]);
  if (!user?.permissions.includes(PERMS.CMS_MANAGE)) return <NotAllowed />;
  if (!form) return <p role="status">Loading pages…</p>;
  const update = (key: keyof Page, value: string | null) => setForm((v) => v && ({ ...v, [key]: value }));
  function editable(p: Page): Page { return p.draftTitle !== null && p.draftTitle !== undefined ? { ...p, title: p.draftTitle, content: p.draftContent ?? p.content, seoTitle: p.draftSeoTitle ?? null, metaDescription: p.draftMetaDescription ?? null, ogImageUrl: p.draftOgImageUrl ?? null, contactEmail: p.draftContactEmail ?? null, contactPhone: p.draftContactPhone ?? null } : p; }
  async function save() {
    if (!form) return;
    const draft = form;
    setSaving(true); setError('');
    try {
      const body = { slug: draft.slug, title: draft.title, content: { html: contentHtml(draft.content) }, seoTitle: draft.seoTitle, metaDescription: draft.metaDescription, ogImageUrl: draft.ogImageUrl, contactEmail: draft.contactEmail, contactPhone: draft.contactPhone };
      const saved = await api.call<Page>((c) => c.PUT('/api/admin/cms/pages', { body }));
      setPages((all) => [...all.filter((p) => p.slug !== slug), saved]); setForm(editable(saved)); toast('Draft saved', 'success');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function discardDraft() {
    setSaving(true); setError('');
    try {
      const saved = await api.call<Page>((c) => c.POST('/api/admin/cms/pages/{slug}/discard-draft', { params: { path: { slug } } }));
      setPages((all) => [...all.filter((p) => p.slug !== slug), saved]); setForm(saved); toast('Unpublished changes discarded', 'success');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function publish() {
    setSaving(true); setError('');
    try {
      const saved = await api.call<Page>((c) => c.POST('/api/admin/cms/pages/{slug}/publish', { params: { path: { slug } } }));
      setPages((all) => [...all.filter((p) => p.slug !== slug), saved]); setForm(editable(saved)); toast(saved.status === 'PUBLISHED' ? 'Page published' : 'Draft saved', 'success');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function unpublish() {
    setSaving(true); setError('');
    try {
      const saved = await api.call<Page>((c) => c.POST('/api/admin/cms/pages/{slug}/unpublish', { params: { path: { slug } } }));
      setPages((all) => [...all.filter((p) => p.slug !== slug), saved]); setForm(saved); toast('Page unpublished', 'success');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <div className="max-w-4xl space-y-5">
    <div><h1 className="text-2xl font-bold">Website content</h1><p className="mt-1 text-muted">Edit pages, SEO metadata, then publish when ready. Drafts are never shown publicly. <Link href="/cms/homepage" className="font-medium underline">Edit homepage content</Link> · <Link href="/cms/blog" className="font-medium underline">Manage blog</Link></p></div>
    {error && <Notice tone="error">{error}</Notice>}
    {hasUnpublishedChanges && <section aria-label="Unpublished changes" className="space-y-3 rounded-md border border-amber-400 bg-amber-50 p-4"><h2 className="font-semibold">Unpublished changes</h2><p>Visitors still see the published version.</p><details><summary className="cursor-pointer underline">Preview draft</summary><div className="mt-3 rounded bg-white p-4"><h3 className="text-xl font-semibold">{form.title}</h3><div dangerouslySetInnerHTML={{ __html: contentHtml(form.content) }} /></div></details><div className="flex gap-3"><Button disabled={saving} onClick={publish}>Publish</Button><Button variant="outline" disabled={saving} onClick={discardDraft}>Discard draft</Button></div></section>}
    <Select id="cms-page" label="Page" value={slug} onChange={(e) => { const next = e.target.value as PageSlug; setSlug(next); setForm(pages.find((p) => p.slug === next) ?? { slug: next, title: titles[next], content: { html: '' }, seoTitle: null, metaDescription: null, ogImageUrl: null, contactEmail: null, contactPhone: null, status: 'DRAFT' }); }}>{slugs.map((s) => <option key={s} value={s}>{titles[s]}</option>)}</Select>
    <p className="text-sm">Status: <strong>{page?.status ?? 'DRAFT'}</strong></p>
    <Field id="cms-title" label="Page title" value={form.title} onChange={(e) => update('title', e.target.value)} />
    <RichTextEditor id="cms-content" label="Page content" value={contentHtml(form.content)} onChange={(html) => setForm((v) => v && ({ ...v, content: { html } }))} />
    {slug === 'contact' && <fieldset className="grid gap-4 rounded-md border border-rule bg-white p-4 sm:grid-cols-2"><legend className="px-1 font-semibold">Contact details</legend><Field id="cms-contact-email" label="Public contact email" type="email" value={form.contactEmail ?? ''} onChange={(e) => update('contactEmail', e.target.value || null)} /><Field id="cms-contact-phone" label="Public contact phone" type="tel" value={form.contactPhone ?? ''} onChange={(e) => update('contactPhone', e.target.value || null)} /></fieldset>}
    <details className="rounded-md border border-rule bg-white p-4"><summary className="cursor-pointer font-semibold">Search and social</summary><div className="mt-4 space-y-4">
      <Field id="cms-seo-title" label="SEO title" value={form.seoTitle ?? ''} onChange={(e) => update('seoTitle', e.target.value || null)} maxLength={160} />
      <label className="block text-sm font-medium" htmlFor="cms-meta">Description</label><textarea id="cms-meta" className="field min-h-24 w-full rounded border border-rule p-3" maxLength={320} value={form.metaDescription ?? ''} onChange={(e) => update('metaDescription', e.target.value || null)} />
      <Field id="cms-og" label="Open Graph image URL" value={form.ogImageUrl ?? ''} onChange={(e) => update('ogImageUrl', e.target.value || null)} hint="Upload through the image button in the editor, then paste the public media URL." />
    </div></details>
    <div className="flex gap-3"><Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save draft'}</Button>{page?.status !== 'PUBLISHED' && <Button variant="outline" disabled={saving || !page} onClick={publish}>Publish</Button>}{page?.status === 'PUBLISHED' && !hasUnpublishedChanges && <Button variant="outline" disabled={saving} onClick={unpublish}>Unpublish</Button>}</div>
  </div>;
}
