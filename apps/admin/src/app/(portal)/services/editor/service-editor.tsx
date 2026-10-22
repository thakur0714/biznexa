'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FormProvider, useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminCategoryRow, AdminServiceDetail, AdminServiceRow, CreateServiceInput } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { Badge, Button, Notice, buttonClass, useToast } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useApi, type Api } from '@biznexa/api-client/react';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import {
  changedSections,
  detailsOf,
  emptyValues,
  keysOf,
  serviceFormSchema,
  TABS,
  tabOf,
  toFormPath,
  toFormValues,
  type Section,
  type ServiceFormValues,
  type TabId,
} from './form';
import { BasicPanel, countErrors, DocumentsPanel, FaqsPanel, PackagesPanel, RelatedPanel, StagesPanel } from './sections';

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

/** Service editor (M2.5.9): `/services/new` creates a service, `/services/{id}` edits one. */
export function ServiceEditorView({ id }: Readonly<{ id?: string }>) {
  const { user } = useAuth();
  const item = findNavItem('services');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <EditorLoader id={id} />;
}

interface Loaded {
  categories: AdminCategoryRow[];
  services: AdminServiceRow[];
  detail: AdminServiceDetail | null;
}

function EditorLoader({ id }: Readonly<{ id?: string }>) {
  const api = useApi();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.call((c) => c.GET('/api/admin/catalogue/categories')),
      api.call((c) => c.GET('/api/admin/catalogue/services', { params: { query: { includeInactive: 'true' } } })),
      id ? api.call((c) => c.GET('/api/admin/catalogue/services/{id}', { params: { path: { id } } })) : Promise.resolve(null),
    ]).then(
      ([categories, services, detail]) => {
        if (cancelled) return;
        setData({ categories, services, detail });
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
        <Notice tone="error">{error.status === 404 ? 'This service does not exist or was removed.' : error.message}</Notice>
        {error.status !== 404 && (
          <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (!data) {
    return (
      <output className="block text-muted">
        Loading…
      </output>
    );
  }
  return <ServiceEditor api={api} {...data} />;
}

function BackLink() {
  return (
    <Link href="/services" className="text-sm text-muted hover:text-ink hover:underline">
      ← All services
    </Link>
  );
}

function ServiceEditor({ api, categories, services, detail }: Loaded & { api: Api }) {
  const router = useRouter();
  const toast = useToast();
  const isNew = !detail;
  const [saved, setSaved] = useState(detail);
  const [tab, setTab] = useState<TabId>('basic');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const form = useForm<ServiceFormValues, unknown, CreateServiceInput>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: detail ? toFormValues(detail) : emptyValues(),
    // Fields on hidden tabs cannot take focus; the editor switches to the first tab with errors instead.
    shouldFocusError: false,
  });
  const { isDirty, errors } = form.formState;

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const errorsByTab = (errs: FieldErrors<ServiceFormValues>) => {
    const counts: Partial<Record<TabId, number>> = {};
    for (const [key, node] of Object.entries(errs)) counts[tabOf(key)] = (counts[tabOf(key)] ?? 0) + countErrors(node);
    return counts;
  };
  const tabErrors = errorsByTab(errors);

  const showFirstError = (errs: FieldErrors<ServiceFormValues>) => {
    const counts = errorsByTab(errs);
    const first = TABS.find((t) => counts[t.id]);
    if (first) setTab(first.id);
    const names = TABS.filter((t) => counts[t.id]).map((t) => t.label);
    setProblem(names.length ? `Please fix the highlighted fields in ${names.join(', ')}.` : 'Please check the form.');
  };

  /** Put the API's field errors next to the fields; `prefix` is the section an array body was sent for. */
  const applyServerErrors = (err: unknown, prefix = '') => {
    if (!(err instanceof ClientApiError)) return setProblem('Something went wrong. Please try again.');
    for (const e of err.errors) form.setError(toFormPath(e.field, prefix) as keyof ServiceFormValues, { type: 'server', message: e.message });
    const firstField = err.errors[0]?.field;
    if (firstField !== undefined) setTab(tabOf(toFormPath(firstField, prefix)));
    setProblem(err.message);
  };

  async function create(input: CreateServiceInput) {
    try {
      const created = await api.call((c) => c.POST('/api/admin/catalogue/services', { body: input }));
      toast(created.isActive ? `${created.name} is live on the website.` : `${created.name} is saved. It is hidden until you switch it on.`, 'success');
      form.reset(toFormValues(created));
      router.replace(`/services/${created.id}`);
    } catch (err) {
      applyServerErrors(err);
    }
  }

  const PREFIX: Record<Section, string> = { details: '', packages: 'packages', documents: 'documents', stages: 'stages', faqs: 'faqs', related: 'relatedServiceIds' };

  function send(section: Section, input: CreateServiceInput, id: string): Promise<AdminServiceDetail> {
    const path = { params: { path: { id } } };
    switch (section) {
      case 'details':
        return api.call((c) => c.PATCH('/api/admin/catalogue/services/{id}', { ...path, body: detailsOf(input) }));
      case 'packages':
        return api.call((c) => c.PUT('/api/admin/catalogue/services/{id}/packages', { ...path, body: input.packages }));
      case 'documents':
        return api.call((c) => c.PUT('/api/admin/catalogue/services/{id}/documents', { ...path, body: input.documents }));
      case 'stages':
        return api.call((c) => c.PUT('/api/admin/catalogue/services/{id}/stages', { ...path, body: input.stages }));
      case 'faqs':
        return api.call((c) => c.PUT('/api/admin/catalogue/services/{id}/faqs', { ...path, body: input.faqs }));
      case 'related':
        return api.call((c) => c.PUT('/api/admin/catalogue/services/{id}/related', { ...path, body: input.relatedServiceIds }));
    }
  }

  /** Save only what changed, section by section; on a failure, what was saved stays saved and the rest stays edited. */
  async function update(input: CreateServiceInput, current: ServiceFormValues) {
    const before = saved!;
    const sections = changedSections(toFormValues(before), current);
    if (!sections.length) return toast('Nothing to save.', 'info');
    let latest = before;
    const done: Section[] = [];
    try {
      for (const section of sections) {
        latest = await send(section, input, before.id); // NOSONAR: sections must save in order because later writes can depend on earlier writes.
        done.push(section);
      }
      setSaved(latest);
      form.reset(toFormValues(latest));
      toast('Changes saved.', 'success');
    } catch (err) {
      const failed = sections[done.length];
      if (done.length) {
        setSaved(latest);
        form.reset(toFormValues(latest));
        for (const s of sections.slice(done.length)) for (const k of keysOf(s)) form.setValue(k, current[k], { shouldDirty: true });
      }
      applyServerErrors(err, PREFIX[failed]);
    }
  }

  const onSubmit = form.handleSubmit(
    async (input) => {
      setProblem(null);
      setSaving(true);
      try {
        await (isNew ? create(input) : update(input, form.getValues()));
      } finally {
        setSaving(false);
      }
    },
    (errs) => showFirstError(errs),
  );

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = i + 1;
    else if (e.key === 'ArrowLeft') next = i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length].id;
    setTab(t);
    tabRefs.current[t]?.focus();
  };

  const category = categories.find((c) => c.id === saved?.categoryId);
  const webUrl = saved && category ? `${WEB_URL}/services/${category.slug}/${saved.slug}` : null;

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} noValidate className="max-w-[1000px] pb-28">
        <BackLink />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-[-0.02em]">{saved?.name ?? 'New service'}</h1>
          {saved && (saved.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>)}
          {saved && (
            <Link href={`/services/${saved.id}/form`} className="text-sm text-ink underline-offset-2 hover:underline">
              Application form
            </Link>
          )}
          {webUrl && saved?.isActive && (
            <a href={webUrl} target="_blank" rel="noreferrer" className="text-sm text-ink underline-offset-2 hover:underline">
              View on website ↗
            </a>
          )}
        </div>
        <p className="mt-1 text-muted">
          {isNew ? 'Fill in each tab, then create the service. It goes live on the website straight away if “Show on the website” is ticked.' : 'Changes appear on the website within a minute of saving.'}
        </p>

        <div role="tablist" aria-label="Service sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-rule">
          {TABS.map((t, i) => {
            const n = tabErrors[t.id] ?? 0;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.id ? 'border-ink text-night' : 'border-transparent text-muted hover:text-night'
                }`}
              >
                {t.label}
                {n > 0 && ' '}
                {n > 0 && (
                  <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold text-white">
                    {n}{' '}
                    <span className="sr-only">{n === 1 ? 'problem' : 'problems'}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {problem && (
          <div className="mt-4">
            <Notice tone="error">{problem}</Notice>
          </div>
        )}

        {TABS.map((t) => (
          <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id} className="mt-6">
            {t.id === 'basic' && <BasicPanel categories={categories} isNew={isNew} />}
            {t.id === 'packages' && <PackagesPanel />}
            {t.id === 'documents' && <DocumentsPanel />}
            {t.id === 'stages' && <StagesPanel />}
            {t.id === 'faqs' && <FaqsPanel />}
            {t.id === 'related' && <RelatedPanel services={services} selfId={saved?.id} />}
          </div>
        ))}

        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-white/95 backdrop-blur lg:left-[260px]">
          <div className="flex max-w-[1000px] flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
            <output className="mr-auto text-sm text-muted">
              {saveStatus(isDirty, isNew)}
            </output>
            {isNew ? (
              <Link href="/services" className={buttonClass('outline')}>
                Cancel
              </Link>
            ) : (
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
            )}
            <Button type="submit" variant="ink" disabled={saving || (!isNew && !isDirty)}>
              {submitLabel(saving, isNew)}
            </Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}

function saveStatus(isDirty: boolean, isNew: boolean): string {
  if (isDirty) return 'Unsaved changes';
  if (isNew) return '';
  return 'All changes saved';
}

function submitLabel(saving: boolean, isNew: boolean): string {
  if (saving) return 'Saving…';
  return isNew ? 'Create service' : 'Save changes';
}
