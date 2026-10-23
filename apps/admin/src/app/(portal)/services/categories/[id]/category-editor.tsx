'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, get, useFieldArray, useForm, useWatch, type FieldPath } from 'react-hook-form';
import type { AdminCategoryDetail } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { Badge, Button, EmptyState, Field, Notice, TextArea, useToast } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { RichTextEditor } from '@/components/rich-text-editor';
import { useApi, type Api } from '@biznexa/api-client/react';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import { messageOf } from '../../editor/sections';

/** What the admin types; the API checks it and its field errors land on these paths. */
export interface CategoryFormValues {
  name: string;
  tagline: string;
  description: string;
  seoTitle: string;
  metaDescription: string;
  seoContent: string;
  faqs: { question: string; answer: string }[];
}

const toFormValues = (c: AdminCategoryDetail): CategoryFormValues => ({
  name: c.name,
  tagline: c.tagline ?? '',
  description: c.description ?? '',
  seoTitle: c.seoTitle ?? '',
  metaDescription: c.metaDescription ?? '',
  seoContent: c.seoContent ?? '',
  faqs: c.faqs.map((f) => ({ question: f.question, answer: f.answer })),
});

/** The PATCH body: FAQs are saved in the order shown, and blank page content clears it. */
const toBody = (v: CategoryFormValues) => ({
  ...v,
  seoContent: v.seoContent || null,
  faqs: v.faqs.map((f, sortOrder) => ({ ...f, sortOrder })),
});

const counter = (value: string, max: number) => `${value.length} / ${max} characters`;

/** Category editor: `/services/categories/{id}` edits a category's text, SEO, page content and FAQs. */
export function CategoryEditorView({ id }: Readonly<{ id: string }>) {
  const { user } = useAuth();
  const item = findNavItem('services');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <EditorLoader id={id} />;
}

function EditorLoader({ id }: Readonly<{ id: string }>) {
  const api = useApi();
  const [detail, setDetail] = useState<AdminCategoryDetail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/catalogue/categories/{id}', { params: { path: { id } } })).then(
      (c) => {
        if (cancelled) return;
        setDetail(c);
        setError(null);
      },
      (err: ClientApiError) => !cancelled && setError({ status: err.status, message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, id, reload]);

  if (error) {
    return (
      <div className="max-w-[720px] space-y-3">
        <BackLink />
        <Notice tone="error">{error.status === 404 ? 'This category does not exist or was removed.' : error.message}</Notice>
        {error.status !== 404 && (
          <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (!detail) {
    return (
      <output className="block text-muted">
        Loading…
      </output>
    );
  }
  return <CategoryEditor api={api} detail={detail} />;
}

function BackLink() {
  return (
    <Link href="/services" className="text-sm text-muted hover:text-ink hover:underline">
      ← All services
    </Link>
  );
}

function Section({ title, description, children }: Readonly<{ title: string; description?: string; children: ReactNode }>) {
  return (
    <section className="rounded-lg border border-rule bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function CategoryEditor({ api, detail }: Readonly<{ api: Api; detail: AdminCategoryDetail }>) {
  const toast = useToast();
  const [saved, setSaved] = useState(detail);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<CategoryFormValues>({ defaultValues: toFormValues(detail) });
  const { control, register } = form;
  const { isDirty, errors } = form.formState;
  const { fields, append, remove, move } = useFieldArray({ control, name: 'faqs' });
  const [seoTitle, metaDescription] = useWatch({ control, name: ['seoTitle', 'metaDescription'] });
  const err = (path: string) => messageOf(get(errors, path));
  // Only the list's own problem (e.g. too many FAQs): a question's error already shows on that question.
  const faqsNode = errors.faqs as { message?: string; root?: { message?: string } } | undefined;
  const faqsError = faqsNode?.message || faqsNode?.root?.message;

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const onSubmit = form.handleSubmit(async (values) => {
    setProblem(null);
    setSaving(true);
    try {
      const updated = await api.call((c) => c.PATCH('/api/admin/catalogue/categories/{id}', { params: { path: { id: saved.id } }, body: toBody(values) }));
      setSaved(updated);
      form.reset(toFormValues(updated));
      toast('Changes saved.', 'success');
    } catch (e) {
      if (!(e instanceof ClientApiError)) {
        setProblem('Something went wrong. Please try again.');
      } else {
        // The API names fields by the body's paths, which are the form's paths ("faqs.0.answer").
        for (const fe of e.errors) form.setError(fe.field as FieldPath<CategoryFormValues>, { type: 'server', message: fe.message });
        setProblem(e.message);
      }
    } finally {
      setSaving(false);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-[1000px] space-y-6 pb-28">
      <div>
        <BackLink />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-[-0.02em]">{saved.name}</h1>
          {saved.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
        </div>
        <p className="mt-1 text-muted">Changes appear on the category page within a minute of saving.</p>
      </div>

      {problem && <Notice tone="error">{problem}</Notice>}

      <Section title="Basic info">
        <Field id="cat-name" label="Name" error={err('name')} {...register('name')} />
        <Field id="cat-tagline" label="Tagline" hint="One line under the category name." error={err('tagline')} {...register('tagline')} />
        <TextArea id="cat-description" label="Description" rows={3} error={err('description')} {...register('description')} />
      </Section>

      <Section title="SEO" description="How the category page shows in search results.">
        <Field id="cat-seo-title" label="SEO title" error={err('seoTitle')} hint={counter(seoTitle, 60)} {...register('seoTitle')} />
        <TextArea id="cat-meta" label="Meta description" rows={2} error={err('metaDescription')} hint={counter(metaDescription, 160)} {...register('metaDescription')} />
      </Section>

      <Section title="Page content" description="Shown below the category’s services.">
        <Controller
          control={control}
          name="seoContent"
          render={({ field }) => <RichTextEditor id="cat-content" label="Page content" value={field.value} onChange={field.onChange} error={err('seoContent')} />}
        />
      </Section>

      <Section title="FAQs">
        {faqsError && (
          <p role="alert" className="text-sm text-danger">
            {faqsError}
          </p>
        )}
        {fields.length === 0 ? (
          <EmptyState title="No questions yet" description="Answer what customers usually ask about this category." />
        ) : (
          <ol className="space-y-4">
            {fields.map((f, i) => (
              <li key={f.id} className="rounded-lg border border-rule bg-white p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Question {i + 1}</h3>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move question ${i + 1} up`}>
                      ↑
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={i === fields.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move question ${i + 1} down`}>
                      ↓
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} aria-label={`Remove question ${i + 1}`}>
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="space-y-4">
                  <Field id={`cat-faq-${i}-q`} label="Question" error={err(`faqs.${i}.question`)} {...register(`faqs.${i}.question`)} />
                  <Controller
                    control={control}
                    name={`faqs.${i}.answer`}
                    render={({ field }) => <RichTextEditor id={`cat-faq-${i}-a`} label="Answer" value={field.value} onChange={field.onChange} error={err(`faqs.${i}.answer`)} />}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
        <Button type="button" variant="outline" onClick={() => append({ question: '', answer: '' })}>
          Add question
        </Button>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-white/95 backdrop-blur lg:left-[260px]">
        <div className="flex max-w-[1000px] flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
          <output className="mr-auto text-sm text-muted">{isDirty ? 'Unsaved changes' : 'All changes saved'}</output>
          <Button
            type="button"
            variant="outline"
            disabled={!isDirty || saving}
            onClick={() => {
              form.reset();
              setProblem(null);
            }}
          >
            Discard changes
          </Button>
          <Button type="submit" variant="ink" disabled={saving || !isDirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
