'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import {
  FORM_FIELD_TYPES,
  formatDate,
  type AdminServiceDetail,
  type FormFieldType,
  type FormSchema,
  type FormSchemaInput,
  type FormSchemaVersion,
  type FormSchemaVersionList,
} from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi, type Api } from '@biznexa/api-client/react';
import { Badge, Button, Checkbox, Dialog, EmptyState, Notice, Select, Table, Td, Th, useToast } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import {
  addField,
  addStep,
  BLANK_FORM,
  canMoveField,
  compactForm,
  EXAMPLE_FORM,
  FIELD_TYPE_LABELS,
  locateNearest,
  moveField,
  moveStep,
  outlineOf,
  parseFormText,
  removeField,
  removeStep,
  serverIssues,
  toJson,
  type FormIssue,
  type OutlineField,
  type OutlineStep,
  type Path,
} from './builder';
import { FormPreview } from './form-preview';

/** Application form builder (M3.4): `/services/{id}/form`. */
export function FormBuilderView({ serviceId }: Readonly<{ serviceId: string }>) {
  const { user } = useAuth();
  const item = findNavItem('services');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <BuilderLoader serviceId={serviceId} />;
}

interface Loaded {
  service: AdminServiceDetail;
  list: FormSchemaVersionList;
  /** The version opened in the editor: the current one, else the latest; null when there is none. */
  opened: FormSchemaVersion | null;
}

function BuilderLoader({ serviceId }: Readonly<{ serviceId: string }>) {
  const api = useApi();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const path = { params: { path: { id: serviceId } } };
    Promise.all([
      api.call((c) => c.GET('/api/admin/catalogue/services/{id}', path)),
      api.call((c) => c.GET('/api/admin/catalogue/services/{id}/form-schemas', path)),
    ])
      .then(async ([service, list]) => {
        const version = list.current ?? list.latest;
        const opened = version === null ? null : await api.call((c) => c.GET('/api/admin/catalogue/services/{id}/form-schemas/{version}', { params: { path: { id: serviceId, version } } }));
        return { service, list, opened };
      })
      .then(
        (loaded) => {
          if (cancelled) return;
          setData(loaded);
          setError(null);
        },
        (err: ClientApiError) => !cancelled && setError({ status: err.status, message: err.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [api, serviceId, reload]);

  if (error) {
    return (
      <div className="max-w-[720px] space-y-3">
        <Link href="/services" className="text-sm text-muted hover:text-ink hover:underline">
          ← All services
        </Link>
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
  return <FormBuilder api={api} {...data} />;
}

const textOf = (v: FormSchemaVersion) => toJson(compactForm(v.schema));

type Tab = 'outline' | 'json';

function FormBuilder({ api, service, list: initialList, opened }: Loaded & { api: Api }) {
  const toast = useToast();
  const [list, setList] = useState(initialList);
  const [basedOn, setBasedOn] = useState<number | null>(opened?.version ?? null);
  const [baseline, setBaseline] = useState(opened ? textOf(opened) : '');
  const [text, setText] = useState(baseline);
  const [started, setStarted] = useState(!!opened);
  const [tab, setTab] = useState<Tab>('outline');
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fromServer, setFromServer] = useState<FormIssue[]>([]);
  const [confirmOpen, setConfirmOpen] = useState<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const parsed = useMemo(() => parseFormText(text), [text]);
  const outline = parsed.kind === 'syntax' ? null : outlineOf(parsed.raw);
  const issues = parsed.kind === 'invalid' ? parsed.issues : fromServer;
  const dirty = text !== baseline;

  // The preview keeps showing the last form that passed while the JSON is being fixed.
  const [previewForm, setPreviewForm] = useState<FormSchema | null>(parsed.kind === 'valid' ? parsed.form : null);
  if (parsed.kind === 'valid' && previewForm !== parsed.form) setPreviewForm(parsed.form);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (next: string) => {
    setText(next);
    setFromServer([]);
    setProblem(null);
  };
  const changeRaw = (raw: unknown) => change(toJson(raw));

  const start = (form: FormSchemaInput) => {
    setStarted(true);
    change(toJson(form));
  };

  /** Show the JSON tab with the cursor at `offset`. */
  const jumpTo = (offset: number) => {
    flushSync(() => setTab('json'));
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(offset, offset);
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, (text.slice(0, offset).split('\n').length - 3) * lineHeight);
  };
  const jumpToPath = (path: Path) => jumpTo(locateNearest(text, path));

  const refreshList = async () => setList(await api.call((c) => c.GET('/api/admin/catalogue/services/{id}/form-schemas', { params: { path: { id: service.id } } })));

  async function save() {
    if (parsed.kind !== 'valid') return;
    setSaving(true);
    setProblem(null);
    try {
      const saved = await api.call((c) =>
        c.POST('/api/admin/catalogue/services/{id}/form-schemas', { params: { path: { id: service.id } }, body: { schema: parsed.raw as FormSchemaInput, activate } }),
      );
      const next = textOf(saved);
      setBaseline(next);
      setText(next);
      setBasedOn(saved.version);
      toast(
        activate
          ? `Version ${saved.version} saved. New applications use it from now on.`
          : draftSavedMessage(saved.version, list.current),
        'success',
      );
      await refreshList().catch(() => undefined);
    } catch (err) {
      if (!(err instanceof ClientApiError)) return setProblem('Something went wrong. Please try again.');
      setFromServer(serverIssues(text, parsed.raw, err.errors));
      setProblem(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function open(version: number) {
    setConfirmOpen(null);
    try {
      const v = await api.call((c) => c.GET('/api/admin/catalogue/services/{id}/form-schemas/{version}', { params: { path: { id: service.id, version } } }));
      const next = textOf(v);
      setBaseline(next);
      setBasedOn(v.version);
      setStarted(true);
      change(next);
    } catch (err) {
      toast(err instanceof ClientApiError ? err.message : 'Could not open that version.', 'error');
    }
  }

  async function makeCurrent(version: number) {
    try {
      await api.call((c) => c.POST('/api/admin/catalogue/services/{id}/form-schemas/{version}/activate', { params: { path: { id: service.id, version } } }));
      toast(`New applications now use version ${version}.`, 'success');
      await refreshList();
    } catch (err) {
      toast(err instanceof ClientApiError ? err.message : 'Could not switch the version.', 'error');
    }
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const t: Tab = tab === 'outline' ? 'json' : 'outline';
    setTab(t);
    tabRefs.current[t]?.focus();
  };

  const nextVersion = (list.latest ?? 0) + 1;
  const basedOnRow = list.versions.find((v) => v.version === basedOn);
  const copyDescription = basedOnDescription(basedOn, basedOnRow?.isCurrent, nextVersion);

  return (
    <div className="max-w-[1400px] pb-28">
      <Link href={`/services/${service.id}`} className="text-sm text-muted hover:text-ink hover:underline">
        ← {service.name}
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-[-0.02em]">Application form</h1>
      <p className="mt-1 max-w-[80ch] text-muted">
        {copyDescription}
      </p>

      {!started ? (
        <EmptyState
          className="mt-6"
          title="No form yet"
          description="Start from the example (company details, directors, registered office) and change it, or start with a single field."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="ink" onClick={() => start(EXAMPLE_FORM)}>
                Start from the example
              </Button>
              <Button variant="outline" onClick={() => start(BLANK_FORM)}>
                Start blank
              </Button>
            </div>
          }
        />
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-label="Form editor" className="min-w-0 space-y-4">
            <div role="tablist" aria-label="Editor views" className="flex gap-1 border-b border-rule">
              {(
                [
                  ['outline', 'Steps & fields'],
                  ['json', 'JSON'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  onKeyDown={onTabKey}
                  className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === id ? 'border-ink text-night' : 'border-transparent text-muted hover:text-night'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <Problems parsed={parsed} issues={issues} onJump={jumpTo} />
            {problem && <Notice tone="error">{problem}</Notice>}

            <div role="tabpanel" id="panel-outline" aria-labelledby="tab-outline" hidden={tab !== 'outline'}>
              {outline ? (
                <Outline steps={outline} issues={issues} onEdit={(fn) => changeRaw(fn(parsed.kind === 'syntax' ? null : parsed.raw))} onJump={jumpToPath} />
              ) : (
                <Notice tone="info">Fix the JSON so it has a list of steps, each with a list of fields, to see the outline here.</Notice>
              )}
            </div>

            <div role="tabpanel" id="panel-json" aria-labelledby="tab-json" hidden={tab !== 'json'} className="space-y-2">
              <label htmlFor="form-json" className="sr-only">
                Form JSON
              </label>
              <textarea
                id="form-json"
                ref={editorRef}
                value={text}
                onChange={(e) => change(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                rows={32}
                aria-invalid={parsed.kind !== 'valid'}
                aria-describedby="form-problems"
                className={`block w-full resize-y rounded-md border bg-white px-3.5 py-3 font-mono text-[13px] leading-5 outline-none focus:border-ink ${parsed.kind === 'valid' ? 'border-rule' : 'border-danger'}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={parsed.kind === 'syntax'} onClick={() => parsed.kind !== 'syntax' && changeRaw(parsed.raw)}>
                  Tidy JSON
                </Button>
                <p className="text-sm text-muted">
                  Field types: {FORM_FIELD_TYPES.join(', ')}. Field names must be unique; <code>showIf</code> may only use a field above it.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="preview-title" className="min-w-0 xl:sticky xl:top-4 xl:self-start">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="preview-title" className="text-lg font-semibold">
                Preview
              </h2>
              <p className="text-sm text-muted">{parsed.kind === 'valid' ? 'As customers will see it.' : 'Showing the last version without problems.'}</p>
            </div>
            {previewForm ? <FormPreview form={previewForm} /> : <Notice tone="info">The preview appears once the form has no problems.</Notice>}
          </section>
        </div>
      )}

      <Versions list={list} basedOn={basedOn} onOpen={(v) => (dirty ? setConfirmOpen(v) : open(v))} onMakeCurrent={makeCurrent} />

      <Dialog
        open={confirmOpen !== null}
        onClose={() => setConfirmOpen(null)}
        title={`Open version ${confirmOpen ?? ''}?`}
        description="Your unsaved changes will be lost."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(null)}>
              Keep editing
            </Button>
            <Button variant="ink" onClick={() => confirmOpen !== null && open(confirmOpen)}>
              Discard and open
            </Button>
          </>
        }
      />

      {started && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-white/95 backdrop-blur lg:left-[260px]">
          <div className="flex max-w-[1400px] flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-8">
            <output className="mr-auto text-sm text-muted">
              {parsed.kind === 'syntax'
                ? 'The JSON has a syntax error'
                : footerStatus(parsed, dirty)}
            </output>
            <Checkbox id="form-activate" label="Use for new applications straight away" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => {
                change(baseline);
                if (!baseline) setStarted(false);
              }}>
              Discard changes
            </Button>
            <Button type="button" variant="ink" disabled={saving || !dirty || parsed.kind !== 'valid'} onClick={save}>
              {saving ? 'Saving…' : `Save as version ${nextVersion}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────── Problems ───────────────

function Problems({ parsed, issues, onJump }: Readonly<{ parsed: ReturnType<typeof parseFormText>; issues: FormIssue[]; onJump: (offset: number) => void }>) {
  if (parsed.kind === 'syntax') {
    return (
      <div id="form-problems" role="alert" className="rounded-md border border-danger/20 bg-danger-050 px-4 py-3 text-sm text-danger">
        <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => onJump(parsed.offset)}>
          Line {parsed.line}, column {parsed.column}:
        </button>{' '}
        {parsed.message}
      </div>
    );
  }
  if (!issues.length) {
    return (
      <p id="form-problems" className="text-sm text-seal">
        No problems found.
      </p>
    );
  }
  const issueKeyCounts = new Map<string, number>();
  return (
    <div id="form-problems" role="alert" className="rounded-md border border-danger/20 bg-danger-050 px-4 py-3 text-sm text-danger">
      <p className="font-semibold">
        {issues.length} {issues.length === 1 ? 'problem' : 'problems'} to fix before saving:
      </p>
      <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
        {issues.map((i) => {
          const base = `${i.offset}:${i.path.join('.')}:${i.message}`;
          const occurrence = issueKeyCounts.get(base) ?? 0;
          issueKeyCounts.set(base, occurrence + 1);
          return (
            <li key={`${base}#${occurrence}`}>
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onJump(i.offset)}>
                <span className="font-medium">Line {i.line}</span> · {i.where}: {i.message}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function draftSavedMessage(version: number, current: number | null): string {
  const currentNote = current ? `New applications still use version ${current}.` : 'No version is in use yet.';
  return `Version ${version} saved as a draft. ${currentNote}`;
}

function footerStatus(parsed: ReturnType<typeof parseFormText>, dirty: boolean): string {
  if (parsed.kind === 'invalid') {
    const noun = parsed.issues.length === 1 ? 'problem' : 'problems';
    return `${parsed.issues.length} ${noun} to fix`;
  }
  if (dirty) return 'Unsaved changes';
  return 'No changes';
}

function basedOnDescription(basedOn: number | null, isCurrent: boolean | undefined, nextVersion: number): string {
  if (basedOn === null) return 'This service has no application form yet. Customers fill it in after choosing a package.';
  const currentNote = isCurrent ? ' (in use)' : '';
  return `Editing a copy of version ${basedOn}${currentNote}. Saving creates version ${nextVersion}; applications already started keep the version they began on.`;
}

// ─────────────── Outline ───────────────

const startsWith = (path: Path, prefix: Path) => prefix.every((p, i) => path[i] === p);

function Outline({ steps, issues, onEdit, onJump }: Readonly<{ steps: OutlineStep[]; issues: FormIssue[]; onEdit: (fn: (raw: unknown) => unknown) => void; onJump: (path: Path) => void }>) {
  const problemsAt = (path: Path) => issues.filter((i) => startsWith(i.path, path)).length;
  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {steps.map((s) => {
          const label = s.title || `step ${s.index + 1}`;
          return (
            <li key={s.index} className="rounded-lg border border-rule bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">
                    Step {s.index + 1}: {s.title || <span className="text-danger">no title</span>}
                  </h3>
                  {s.description && <p className="text-sm text-muted">{s.description}</p>}
                </div>
                <Actions
                  label={label}
                  canUp={s.index > 0}
                  canDown={s.index < steps.length - 1}
                  onUp={() => onEdit((r) => moveStep(r, s.index, s.index - 1))}
                  onDown={() => onEdit((r) => moveStep(r, s.index, s.index + 1))}
                  onEdit={() => onJump(s.path)}
                  onRemove={steps.length > 1 ? () => onEdit((r) => removeStep(r, s.index)) : undefined}
                />
              </div>
              <FieldList steps={steps} step={s.index} fields={s.fields} problemsAt={problemsAt} onEdit={onEdit} onJump={onJump} />
            </li>
          );
        })}
      </ol>
      <Button type="button" variant="outline" size="sm" onClick={() => onEdit(addStep)}>
        Add step
      </Button>
    </div>
  );
}

function FieldList({
  steps,
  step,
  parent,
  fields,
  problemsAt,
  onEdit,
  onJump,
}: Readonly<{
  steps: OutlineStep[];
  step: number;
  parent?: number;
  fields: OutlineField[];
  problemsAt: (path: Path) => number;
  onEdit: (fn: (raw: unknown) => unknown) => void;
  onJump: (path: Path) => void;
}>) {
  const [type, setType] = useState<FormFieldType>('text');
  const types = parent === undefined ? FORM_FIELD_TYPES : FORM_FIELD_TYPES.filter((t) => t !== 'repeater');
  const addId = `add-${step}-${parent ?? 'step'}`;
  return (
    <div className={parent === undefined ? 'mt-3' : 'mt-2 border-l-2 border-rule pl-3'}>
      <ul className="divide-y divide-rule rounded-md border border-rule">
        {fields.map((f) => {
          const n = problemsAt(f.path);
          const label = f.label || f.name || `field ${f.index + 1}`;
          return (
            <li key={f.index} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {f.label || <span className="text-danger">no label</span>}
                    {f.required && <span className="ml-1 text-danger" aria-label="required">*</span>}
                  </p>
                  <p className="text-xs text-muted">
                    <span>{FIELD_TYPE_LABELS[f.type as FormFieldType] ?? `unknown type “${f.type}”`}</span> · <code>{f.name || '(no name)'}</code>
                    {f.showIf && <> · shown if {f.showIf}</>}
                  </p>
                </div>
                {n > 0 && (
                  <Badge tone="danger">
                    {n} {n === 1 ? 'problem' : 'problems'}
                  </Badge>
                )}
                <Actions
                  label={label}
                  canUp={canMoveField(steps, step, f.index, -1, parent)}
                  canDown={canMoveField(steps, step, f.index, 1, parent)}
                  onUp={() => onEdit((r) => moveField(r, step, f.index, -1, parent))}
                  onDown={() => onEdit((r) => moveField(r, step, f.index, 1, parent))}
                  onEdit={() => onJump(f.path)}
                  onRemove={() => onEdit((r) => removeField(r, step, f.index, parent))}
                />
              </div>
              {f.fields && <FieldList steps={steps} step={step} parent={f.index} fields={f.fields} problemsAt={problemsAt} onEdit={onEdit} onJump={onJump} />}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Select id={addId} label={parent === undefined ? 'New field type' : 'New sub-field type'} className="w-48" value={type} onChange={(e) => setType(e.target.value as FormFieldType)}>
          {types.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" size="sm" className="mb-1" onClick={() => onEdit((r) => addField(r, step, type, parent))}>
          {parent === undefined ? 'Add field' : 'Add sub-field'}
        </Button>
      </div>
    </div>
  );
}

function Actions({ label, canUp, canDown, onUp, onDown, onEdit, onRemove }: Readonly<{ label: string; canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void; onEdit: () => void; onRemove?: () => void }>) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button type="button" variant="ghost" size="sm" disabled={!canUp} onClick={onUp} aria-label={`Move ${label} up`}>
        ↑
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={!canDown} onClick={onDown} aria-label={`Move ${label} down`}>
        ↓
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${label} in JSON`}>
        Edit
      </Button>
      {onRemove && (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${label}`}>
          Remove
        </Button>
      )}
    </div>
  );
}

// ─────────────── Versions ───────────────

function Versions({ list, basedOn, onOpen, onMakeCurrent }: Readonly<{ list: FormSchemaVersionList; basedOn: number | null; onOpen: (v: number) => void; onMakeCurrent: (v: number) => void }>) {
  if (!list.versions.length) return null;
  return (
    <section aria-labelledby="versions-title" className="mt-10">
      <h2 id="versions-title" className="text-lg font-semibold">
        Versions
      </h2>
      <p className="mt-0.5 text-sm text-muted">Saved versions never change. New applications use the one marked “In use”.</p>
      <div className="mt-3">
        <Table caption="Form versions">
          <thead>
            <tr>
              <Th>Version</Th>
              <Th>Saved</Th>
              <Th>Steps</Th>
              <Th>Fields</Th>
              <Th>Applications</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {list.versions.map((v) => (
              <tr key={v.id}>
                <Td>
                  <span className="font-medium">Version {v.version}</span>
                  {v.isCurrent && (
                    <Badge tone="success" className="ml-2">
                      In use
                    </Badge>
                  )}
                  {v.version === basedOn && <Badge className="ml-2">Open</Badge>}
                </Td>
                <Td>{formatDate(v.createdAt)}</Td>
                <Td>{v.steps}</Td>
                <Td>{v.fields}</Td>
                <Td>{v.applications}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(v.version)} aria-label={`Open version ${v.version}`}>
                      Open
                    </Button>
                    {!v.isCurrent && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => onMakeCurrent(v.version)} aria-label={`Use version ${v.version} for new applications`}>
                        Use for new applications
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </section>
  );
}
