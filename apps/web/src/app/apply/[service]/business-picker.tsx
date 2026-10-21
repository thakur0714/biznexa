'use client';

import { ENTITY_TYPES, type BusinessEntity, type BusinessEntityInput } from '@biznexa/types';
import { Field, Select } from '@biznexa/ui';

/** What the application is for: one of the customer's saved businesses, a new one, or themself. */
export type BusinessChoice = { kind: 'saved'; id: string } | { kind: 'new' } | { kind: 'none' };

/** The parts of a saved business the picker shows. */
export type SavedBusiness = Pick<BusinessEntity, 'id' | 'legalName' | 'entityType' | 'gstin'>;

export const EMPTY_BUSINESS: BusinessEntityInput = { legalName: '', entityType: 'PRIVATE_LIMITED', gstin: '', pan: '' };

const typeLabel = (v: string) => ENTITY_TYPES.find((t) => t.value === v)?.label ?? v;

interface Props {
  businesses: SavedBusiness[] | null;
  loadError: string;
  choice: BusinessChoice;
  onChoice: (c: BusinessChoice) => void;
  draft: BusinessEntityInput;
  onDraft: (d: BusinessEntityInput) => void;
  errors: Record<string, string>;
  disabled: boolean;
}

/** Radio list of saved businesses + "Add a new business" (short form; the rest is in Profile & Businesses) + "Myself". */
export function BusinessPicker({ businesses, loadError, choice, onChoice, draft, onDraft, errors, disabled }: Readonly<Props>) {
  const isSaved = (id: string) => choice.kind === 'saved' && choice.id === id;
  const option = 'flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink-050';
  const radio = 'mt-0.5 h-4 w-4 shrink-0 accent-ink';

  return (
    <fieldset className="mt-6" disabled={disabled}>
      <legend className="font-semibold">Who is this application for?</legend>
      <p className="mt-1 text-sm text-muted">We use the business to fill in your form and to put its GSTIN on your invoice.</p>

      {businesses === null && !loadError && (
        <output className="mt-3 block text-sm text-muted">
          Loading your businesses…
        </output>
      )}
      {loadError && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {loadError}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {businesses?.map((b) => (
          <label key={b.id} htmlFor={`business-${b.id}`} aria-label={b.legalName} className={`${option} border-rule`}>
            <input id={`business-${b.id}`} type="radio" name="business" className={radio} checked={isSaved(b.id)} onChange={() => onChoice({ kind: 'saved', id: b.id })} />
            <span className="min-w-0">
              <span className="block font-medium text-night">{b.legalName}</span>
              <span className="block break-words text-muted">
                {typeLabel(b.entityType)}
                {b.gstin && <> · GSTIN {b.gstin}</>}
              </span>
            </span>
          </label>
        ))}

        <label htmlFor="business-new" className={`${option} border-rule`}>
          <input id="business-new" type="radio" name="business" className={radio} checked={choice.kind === 'new'} onChange={() => onChoice({ kind: 'new' })} />
          <span className="font-medium text-night">Add a new business</span>
        </label>
        {choice.kind === 'new' && (
          <div className="grid grid-cols-1 gap-4 rounded-md border border-rule p-4 sm:grid-cols-2">
            <Field
              id="biz-name"
              label="Legal name"
              className="sm:col-span-2"
              autoComplete="organization"
              value={draft.legalName}
              error={errors.legalName}
              onChange={(e) => onDraft({ ...draft, legalName: e.target.value })}
            />
            <Select id="biz-type" label="Type of business" value={draft.entityType} error={errors.entityType} onChange={(e) => onDraft({ ...draft, entityType: e.target.value as BusinessEntityInput['entityType'] })}>
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Field
              id="biz-gstin"
              label="GSTIN (optional)"
              hint="Leave blank if not registered for GST"
              maxLength={15}
              value={draft.gstin ?? ''}
              error={errors.gstin}
              onChange={(e) => onDraft({ ...draft, gstin: e.target.value.toUpperCase() })}
            />
            <Field
              id="biz-pan"
              label="PAN (optional)"
              maxLength={10}
              value={draft.pan ?? ''}
              error={errors.pan}
              onChange={(e) => onDraft({ ...draft, pan: e.target.value.toUpperCase() })}
            />
          </div>
        )}

        <label htmlFor="business-none" aria-label="Myself" className={`${option} border-rule`}>
          <input id="business-none" type="radio" name="business" className={radio} checked={choice.kind === 'none'} onChange={() => onChoice({ kind: 'none' })} />
          <span>
            <span className="block font-medium text-night">Myself</span>
            <span className="block text-muted">Not for a business, or the business is not set up yet</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
