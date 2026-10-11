'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { get, useController, useFieldArray, useFormContext, useWatch, type FieldErrors } from 'react-hook-form';
import {
  calculatePrice,
  FILE_TYPES,
  formatINR,
  MAX_RELATED_SERVICES,
  SERVICE_ICONS,
  SERVICE_RECURRENCES,
  slugify,
  type AdminCategoryRow,
  type AdminServiceRow,
} from '@biznexa/types';
import { Badge, Button, Checkbox, EmptyState, Field, Select, TextArea } from '@biznexa/ui';
import { newDocument, newPackage, newStage, type ServiceFormValues } from './form';

/** First error message at or under an RHF error node (lists of lines report on the list). */
export function messageOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { message?: unknown; root?: unknown };
  if (typeof e.message === 'string' && e.message) return e.message;
  for (const [k, v] of Object.entries(err)) {
    if (k === 'ref') continue;
    const m = messageOf(v);
    if (m) return m;
  }
  return undefined;
}

/** Number of error messages under an RHF error node. */
export function countErrors(err: unknown): number {
  if (!err || typeof err !== 'object') return 0;
  const own = typeof (err as { message?: unknown }).message === 'string' ? 1 : 0;
  return own + Object.entries(err).reduce((n, [k, v]) => (k === 'ref' || k === 'message' ? n : n + countErrors(v)), 0);
}

function useEditor() {
  const form = useFormContext<ServiceFormValues>();
  const errors = form.formState.errors as FieldErrors<ServiceFormValues>;
  const err = (path: string) => messageOf(get(errors, path));
  /** An error about a whole list ("Add at least one package"), not about one of its rows. */
  const listErr = (path: string) => {
    const node = get(errors, path) as { message?: string; root?: { message?: string } } | undefined;
    return node?.message ?? node?.root?.message;
  };
  return { ...form, err, listErr };
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-rule bg-white p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

const counter = (value: string | undefined, max: number) => `${value?.length ?? 0} / ${max} characters`;

// ─────────────── Basic info & SEO ───────────────

export function BasicPanel({ categories, isNew }: { categories: AdminCategoryRow[]; isNew: boolean }) {
  const { register, setValue, err, control, formState } = useEditor();
  const [categoryId, slug, seoTitle, metaDescription, recurrence, name, shortDescription] = useWatch({
    control,
    name: ['categoryId', 'slug', 'seoTitle', 'metaDescription', 'recurrence', 'name', 'shortDescription'],
  });
  const category = categories.find((c) => c.id === categoryId);
  // While creating, the URL follows the name until the admin edits it.
  const [slugFollowsName, setSlugFollowsName] = useState(isNew);
  const revalidate = formState.isSubmitted;

  return (
    <div className="space-y-6">
      <Section title="Service">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="svc-name"
            label="Name"
            error={err('name')}
            {...register('name', {
              onChange: (e) => slugFollowsName && setValue('slug', slugify(e.target.value), { shouldDirty: true, shouldValidate: revalidate }),
            })}
          />
          <Field
            id="svc-slug"
            label="Web address"
            error={err('slug')}
            hint={`/services/${category?.slug ?? '…'}/${slug || '…'}`}
            {...register('slug', { onChange: () => setSlugFollowsName(false) })}
          />
          <Select
            id="svc-category"
            label="Category"
            error={err('categoryId')}
            {...register('categoryId', { onChange: () => setValue('subcategoryId', '', { shouldDirty: true }) })}
          >
            <option value="">Choose a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
          <Select
            id="svc-subcategory"
            label="Subcategory"
            error={err('subcategoryId')}
            disabled={!category?.subcategories.length}
            hint={category && !category.subcategories.length ? 'This category has no subcategories.' : undefined}
            {...register('subcategoryId')}
          >
            <option value="">None</option>
            {category?.subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </div>
        <TextArea
          id="svc-short"
          label="Short description"
          rows={2}
          error={err('shortDescription')}
          hint={`Shown on service cards and at the top of the page. ${counter(shortDescription, 300)}`}
          {...register('shortDescription')}
        />
        <TextArea id="svc-overview" label="Overview" rows={7} error={err('overview')} hint="Separate paragraphs with a blank line." {...register('overview')} />
        <TextArea id="svc-benefits" label="Benefits" rows={4} error={err('benefits')} hint="One per line." {...register('benefits')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select id="svc-icon" label="Icon" error={err('icon')} {...register('icon')}>
            <option value="">Default (document)</option>
            {SERVICE_ICONS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
          <Field id="svc-image" label="Image link" placeholder="https://" error={err('imageUrl')} {...register('imageUrl')} />
        </div>
      </Section>

      <Section title="Timing and tax">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="svc-time" label="Estimated time" placeholder="7–10 working days" error={err('estimatedTime')} {...register('estimatedTime')} />
          <Field id="svc-days-min" label="Minimum days" inputMode="numeric" error={err('estimatedDaysMin')} {...register('estimatedDaysMin')} />
          <Field id="svc-days-max" label="Maximum days" inputMode="numeric" error={err('estimatedDaysMax')} {...register('estimatedDaysMax')} />
          <Field id="svc-sac" label="SAC code" inputMode="numeric" error={err('sacCode')} {...register('sacCode')} />
          <Select id="svc-recurrence" label="Repeats" error={err('recurrence')} hint="For compliance services that are due again." {...register('recurrence')}>
            <option value="">Does not repeat</option>
            {SERVICE_RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0) + r.slice(1).toLowerCase().replace('_', '-')}
              </option>
            ))}
          </Select>
          {recurrence && (
            <Field
              id="svc-reminders"
              label="Reminders (days before due)"
              placeholder="30, 15, 7, 1"
              error={err('reminderOffsets')}
              hint="Separate with commas."
              {...register('reminderOffsets')}
            />
          )}
        </div>
      </Section>

      <Section title="Visibility">
        <Checkbox id="svc-active" label="Show on the website" hint="When off, the service is hidden and cannot be ordered." {...register('isActive')} />
        <Checkbox id="svc-popular" label="Popular" hint="Listed among popular services on the home page." {...register('isPopular')} />
        <Field
          id="svc-popularity"
          label="Popularity score"
          inputMode="numeric"
          className="max-w-[200px]"
          error={err('popularity')}
          hint="Higher shows first."
          {...register('popularity')}
        />
      </Section>

      <Section title="Search engines" description="Leave blank to use the name and short description.">
        <Field id="svc-seo-title" label="Page title" error={err('seoTitle')} hint={counter(seoTitle, 70)} {...register('seoTitle')} />
        <TextArea id="svc-meta" label="Meta description" rows={2} error={err('metaDescription')} hint={counter(metaDescription, 170)} {...register('metaDescription')} />
        <div className="rounded-md bg-paper p-4" aria-label="Search result preview">
          <p className="text-xs text-muted">Search result preview</p>
          <p className="mt-1 truncate text-[17px] text-ink">{seoTitle || (name ? `${name} | BizNexa` : 'Page title')}</p>
          <p className="line-clamp-2 text-sm text-muted">{metaDescription || shortDescription || 'Meta description'}</p>
        </div>
      </Section>
    </div>
  );
}

// ─────────────── Shared row controls ───────────────

function RowActions({ label, index, count, move, remove, removeBlocked }: { label: string; index: number; count: number; move: (from: number, to: number) => void; remove: () => void; removeBlocked?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, index - 1)} aria-label={`Move ${label} up`}>
        ↑
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={index === count - 1} onClick={() => move(index, index + 1)} aria-label={`Move ${label} down`}>
        ↓
      </Button>
      {removeBlocked ? (
        <span className="px-2 text-xs text-muted">{removeBlocked}</span>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={remove} aria-label={`Remove ${label}`}>
          Remove
        </Button>
      )}
    </div>
  );
}

function Row({ title, actions, children }: { title: ReactNode; actions: ReactNode; children: ReactNode }) {
  return (
    <li className="rounded-lg border border-rule bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </li>
  );
}

function ListError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null;
}

/** An array field shown as a set of checkboxes (a single RHF checkbox would give a boolean, not a list). */
function CheckboxGroup({ name, legend, options, hint }: { name: `documents.${number}.${'acceptedTypes' | 'packageIds'}`; legend: string; options: { value: string; label: string }[]; hint?: string }) {
  const { control, err } = useEditor();
  const { field } = useController({ control, name });
  const value = field.value;
  const error = err(name);
  return (
    <fieldset aria-describedby={error ? `${name}-err` : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-night">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <Checkbox
            key={o.value}
            id={`${name}-${o.value}`}
            label={o.label}
            checked={value.includes(o.value)}
            onChange={(e) => field.onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
          />
        ))}
      </div>
      {error ? (
        <p id={`${name}-err`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>
      )}
    </fieldset>
  );
}

// ─────────────── Packages ───────────────

const GST_RATES = ['0', '5', '12', '18', '28'];

export function PackagesPanel() {
  const { control, register, setValue, getValues, err, listErr } = useEditor();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'packages' });
  const packages = useWatch({ control, name: 'packages' });

  return (
    <div className="space-y-4">
      <p className="text-muted">Prices are in rupees. GST is added on the professional fee; the government fee is passed on without tax.</p>
      <ListError message={listErr('packages')} />
      <ol className="space-y-4">
        {fields.map((f, i) => {
          const p = packages[i] ?? f;
          const label = p.name || `package ${i + 1}`;
          const preview = previewPrice(p.professionalFee, p.governmentFee, p.gstRate);
          return (
            <Row
              key={f.id}
              title={
                <>
                  {p.name || `Package ${i + 1}`}
                  {!p.isActive && <Badge className="ml-2">Off</Badge>}
                </>
              }
              actions={
                <RowActions
                  label={label}
                  index={i}
                  count={fields.length}
                  move={move}
                  remove={() => remove(i)}
                  removeBlocked={f.inUse ? 'Ordered by customers — switch it off instead' : undefined}
                />
              }
            >
              <div className="grid gap-4 sm:grid-cols-4">
                <Field id={`pkg-${i}-name`} label="Name" placeholder="Basic" error={err(`packages.${i}.name`)} {...register(`packages.${i}.name`)} />
                <Field
                  id={`pkg-${i}-fee`}
                  label="Professional fee (₹)"
                  inputMode="decimal"
                  error={err(`packages.${i}.professionalFee`)}
                  {...register(`packages.${i}.professionalFee`)}
                />
                <Field
                  id={`pkg-${i}-gov`}
                  label="Government fee (₹)"
                  inputMode="decimal"
                  placeholder="0"
                  error={err(`packages.${i}.governmentFee`)}
                  {...register(`packages.${i}.governmentFee`)}
                />
                <Select id={`pkg-${i}-gst`} label="GST rate" error={err(`packages.${i}.gstRate`)} {...register(`packages.${i}.gstRate`)}>
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </div>
              {preview && <p className="text-sm text-muted">Customer pays {preview} including GST and government fee.</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <TextArea id={`pkg-${i}-inc`} label="What's included" rows={4} hint="One per line." error={err(`packages.${i}.inclusions`)} {...register(`packages.${i}.inclusions`)} />
                <Field
                  id={`pkg-${i}-time`}
                  label="Estimated time"
                  hint="Leave blank to use the service's time."
                  error={err(`packages.${i}.estimatedTime`)}
                  {...register(`packages.${i}.estimatedTime`)}
                />
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <Checkbox id={`pkg-${i}-active`} label="Available to order" {...register(`packages.${i}.isActive`)} />
                <Checkbox
                  id={`pkg-${i}-popular`}
                  label="Most popular"
                  {...register(`packages.${i}.isMostPopular`, {
                    // Only one package carries the "Most popular" label.
                    onChange: (e) => e.target.checked && getValues('packages').forEach((_, j) => j !== i && setValue(`packages.${j}.isMostPopular`, false, { shouldDirty: true })),
                  })}
                />
                <Checkbox id={`pkg-${i}-partial`} label="Allow part payment" {...register(`packages.${i}.allowPartial`)} />
              </div>
              {p.allowPartial && (
                <Field
                  id={`pkg-${i}-advance`}
                  label="Advance (%)"
                  inputMode="numeric"
                  className="max-w-[200px]"
                  error={err(`packages.${i}.advancePercent`)}
                  {...register(`packages.${i}.advancePercent`)}
                />
              )}
            </Row>
          );
        })}
      </ol>
      <Button type="button" variant="outline" onClick={() => append(newPackage())}>
        Add package
      </Button>
    </div>
  );
}

function previewPrice(fee: string, gov: string, gst: string) {
  const toPaise = (v: string) => Math.round(Number(v.replace(/[₹,\s]/g, '') || 0) * 100);
  const professionalFee = toPaise(fee);
  const governmentFee = toPaise(gov);
  if (!fee.trim() || !Number.isFinite(professionalFee) || !Number.isFinite(governmentFee) || professionalFee < 0 || governmentFee < 0) return null;
  return formatINR(calculatePrice({ professionalFee, governmentFee, gstRate: Number(gst) }).total, true);
}

// ─────────────── Documents ───────────────

const TYPE_OPTIONS = Object.entries(FILE_TYPES).map(([value, t]) => ({ value, label: t.label }));

export function DocumentsPanel() {
  const { control, register, err, listErr } = useEditor();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'documents' });
  const [documents, packages] = useWatch({ control, name: ['documents', 'packages'] });
  const packageOptions = packages.map((p, i) => ({ value: p.id, label: p.name || `Package ${i + 1}` }));

  return (
    <div className="space-y-4">
      <p className="text-muted">Documents the customer uploads after ordering. Leave all packages unticked to ask for a document in every package.</p>
      <ListError message={listErr('documents')} />
      {fields.length === 0 ? (
        <EmptyState title="No documents asked for" description="Add the documents the team needs from the customer." />
      ) : (
        <ol className="space-y-4">
          {fields.map((f, i) => {
            const name = documents[i]?.name || `Document ${i + 1}`;
            return (
              <Row
                key={f.id}
                title={name}
                actions={
                  <RowActions
                    label={name}
                    index={i}
                    count={fields.length}
                    move={move}
                    remove={() => remove(i)}
                    removeBlocked={f.inUse ? 'Customers have uploaded it' : undefined}
                  />
                }
              >
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                  <Field id={`doc-${i}-name`} label="Name" placeholder="PAN card of the applicant" error={err(`documents.${i}.name`)} {...register(`documents.${i}.name`)} />
                  <Field id={`doc-${i}-size`} label="Largest file (MB)" inputMode="numeric" error={err(`documents.${i}.maxSizeMb`)} {...register(`documents.${i}.maxSizeMb`)} />
                </div>
                <TextArea id={`doc-${i}-desc`} label="Help text" rows={2} error={err(`documents.${i}.description`)} {...register(`documents.${i}.description`)} />
                <Checkbox id={`doc-${i}-mandatory`} label="Required" hint="Optional documents can be skipped by the customer." {...register(`documents.${i}.isMandatory`)} />
                <CheckboxGroup name={`documents.${i}.acceptedTypes`} legend="File types" options={TYPE_OPTIONS} />
                {packageOptions.length > 1 && <CheckboxGroup name={`documents.${i}.packageIds`} legend="Only for packages" options={packageOptions} hint="None ticked = every package." />}
              </Row>
            );
          })}
        </ol>
      )}
      <Button type="button" variant="outline" onClick={() => append(newDocument())}>
        Add document
      </Button>
    </div>
  );
}

// ─────────────── Stages ───────────────

export function StagesPanel() {
  const { control, register, err, listErr } = useEditor();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'stages' });
  const stages = useWatch({ control, name: 'stages' });

  return (
    <div className="space-y-4">
      <p className="text-muted">The steps a customer sees on their application timeline, in order.</p>
      <ListError message={listErr('stages')} />
      <ol className="space-y-4">
        {fields.map((f, i) => {
          const name = stages[i]?.name || `Stage ${i + 1}`;
          return (
            <Row
              key={f.id}
              title={`${i + 1}. ${name}`}
              actions={
                <RowActions label={name} index={i} count={fields.length} move={move} remove={() => remove(i)} removeBlocked={f.inUse ? 'On application timelines' : undefined} />
              }
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                <Field id={`stage-${i}-name`} label="Name" error={err(`stages.${i}.name`)} {...register(`stages.${i}.name`)} />
                <Field id={`stage-${i}-desc`} label="Description" error={err(`stages.${i}.description`)} {...register(`stages.${i}.description`)} />
              </div>
            </Row>
          );
        })}
      </ol>
      <Button type="button" variant="outline" onClick={() => append(newStage())}>
        Add stage
      </Button>
    </div>
  );
}

// ─────────────── FAQs ───────────────

export function FaqsPanel() {
  const { control, register, err, listErr } = useEditor();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'faqs' });

  return (
    <div className="space-y-4">
      <ListError message={listErr('faqs')} />
      {fields.length === 0 ? (
        <EmptyState title="No questions yet" description="Answer what customers usually ask before ordering." />
      ) : (
        <ol className="space-y-4">
          {fields.map((f, i) => (
            <Row key={f.id} title={`Question ${i + 1}`} actions={<RowActions label={`question ${i + 1}`} index={i} count={fields.length} move={move} remove={() => remove(i)} />}>
              <Field id={`faq-${i}-q`} label="Question" error={err(`faqs.${i}.question`)} {...register(`faqs.${i}.question`)} />
              <TextArea id={`faq-${i}-a`} label="Answer" rows={3} error={err(`faqs.${i}.answer`)} {...register(`faqs.${i}.answer`)} />
            </Row>
          ))}
        </ol>
      )}
      <Button type="button" variant="outline" onClick={() => append({ question: '', answer: '' })}>
        Add question
      </Button>
    </div>
  );
}

// ─────────────── Related services ───────────────

export function RelatedPanel({ services, selfId }: { services: AdminServiceRow[]; selfId?: string }) {
  const { control, listErr } = useEditor();
  const { field } = useController({ control, name: 'relatedServiceIds' });
  const [query, setQuery] = useState('');
  const selected = field.value;
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const full = selected.length >= MAX_RELATED_SERVICES;

  const q = query.trim().toLowerCase();
  const options = services.filter(
    (s) => s.id !== selfId && !selected.includes(s.id) && (!q || s.name.toLowerCase().includes(q) || s.category.name.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-5">
      <p className="text-muted">
        Shown as &ldquo;Related services&rdquo; at the bottom of the service page (only the active ones). Up to {MAX_RELATED_SERVICES}.
      </p>
      <ListError message={listErr('relatedServiceIds')} />
      <section aria-labelledby="related-selected" className="rounded-lg border border-rule bg-white p-5">
        <h2 id="related-selected" className="font-semibold">
          Selected ({selected.length})
        </h2>
        {selected.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet — pick from the list below.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule">
            {selected.map((id) => {
              const s = byId.get(id);
              const name = s?.name ?? 'Removed service';
              return (
                <li key={id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {name}
                    {s && <span className="text-sm text-muted"> · {s.category.name}</span>}
                    {s && !s.isActive && <Badge className="ml-2">Inactive</Badge>}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange(selected.filter((x) => x !== id))} aria-label={`Remove ${name} from related services`}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div>
        <Field id="related-search" label="Find services" type="search" placeholder="Name or category" value={query} onChange={(e) => setQuery(e.target.value)} />
        {full && <p className="mt-2 text-sm text-muted">The list is full. Remove one to add another.</p>}
        <ul className="mt-3 max-h-[420px] divide-y divide-rule overflow-y-auto rounded-lg border border-rule bg-white">
          {options.length === 0 ? (
            <li className="p-4 text-sm text-muted">No other services match.</li>
          ) : (
            options.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>
                  {s.name}
                  <span className="text-sm text-muted"> · {s.category.name}</span>
                  {!s.isActive && <Badge className="ml-2">Inactive</Badge>}
                </span>
                <Button type="button" variant="outline" size="sm" disabled={full} onClick={() => field.onChange([...selected, s.id])} aria-label={`Add ${s.name} to related services`}>
                  Add
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
