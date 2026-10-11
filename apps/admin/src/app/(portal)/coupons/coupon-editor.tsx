'use client';

import { useState, type FormEvent } from 'react';
import type { AdminCouponRow, CouponServiceOption } from '@biznexa/types';
import { Button, Checkbox, Dialog, Field, Notice, Select } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { couponFormErrors, emptyCouponForm, formFieldOf, toCouponForm, toCouponRequest, type CouponFormField, type CouponFormValues } from './coupon-form';

type Errors = Partial<Record<CouponFormField, string>>;

/**
 * Create or edit one coupon in a dialog. Checks the form with the API's schema before sending, and
 * shows the API's own field errors (code taken, rules on the merged coupon) the same way.
 */
export function CouponEditor({
  coupon,
  services,
  onClose,
  onSaved,
}: {
  /** null = new coupon. */
  coupon: AdminCouponRow | null;
  services: CouponServiceOption[];
  onClose: () => void;
  onSaved: (row: AdminCouponRow, created: boolean) => void;
}) {
  const api = useApi();
  const [values, setValues] = useState<CouponFormValues>(() => (coupon ? toCouponForm(coupon) : emptyCouponForm()));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends CouponFormField>(key: K, value: CouponFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const percent = values.type === 'PERCENTAGE';
  // A service the coupon already has may have been removed from the catalogue since; keep showing it.
  const removed = (coupon?.services ?? []).filter((s) => s.removed || !services.some((o) => o.id === s.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = couponFormErrors(values);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const body = toCouponRequest(values);
      const row = coupon
        ? await api.call((c) => c.PATCH('/api/admin/coupons/{id}', { params: { path: { id: coupon.id } }, body }))
        : await api.call((c) => c.POST('/api/admin/coupons', { body }));
      onSaved(row, !coupon);
    } catch (err) {
      if (err instanceof ClientApiError && err.errors.length) {
        setErrors(Object.fromEntries(err.errors.map((x) => [formFieldOf(x.field), x.message])));
      } else setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !saving && onClose()}
      title={coupon ? `Edit ${coupon.code}` : 'New coupon'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="ink" type="submit" form="coupon-form" disabled={saving}>
            {saving ? 'Saving…' : coupon ? 'Save changes' : 'Create coupon'}
          </Button>
        </>
      }
    >
      <form id="coupon-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <div className="sm:col-span-2">
            <Notice tone="error">{formError}</Notice>
          </div>
        )}
        <Field
          id="coupon-code"
          label="Code"
          value={values.code}
          onChange={(e) => set('code', e.target.value.toUpperCase())}
          error={errors.code}
          hint={coupon?.inUse ? 'Orders already use this code, so it cannot change.' : 'Letters, numbers, - and _. Customers can type it in any case.'}
          disabled={coupon?.inUse}
          autoComplete="off"
          className="sm:col-span-2"
        />
        <Select id="coupon-type" label="Discount type" value={values.type} onChange={(e) => set('type', e.target.value as CouponFormValues['type'])}>
          <option value="PERCENTAGE">Percentage of the professional fee</option>
          <option value="FIXED">Fixed amount off</option>
        </Select>
        <Field
          id="coupon-value"
          label={percent ? 'Discount (%)' : 'Discount (₹)'}
          inputMode={percent ? 'numeric' : 'decimal'}
          value={values.value}
          onChange={(e) => set('value', e.target.value)}
          error={errors.value}
        />
        {percent && (
          <Field
            id="coupon-max"
            label="Maximum discount (₹)"
            inputMode="decimal"
            value={values.maxDiscount}
            onChange={(e) => set('maxDiscount', e.target.value)}
            error={errors.maxDiscount}
            hint="Leave blank for no cap."
          />
        )}
        <Field
          id="coupon-min"
          label="Minimum order (₹)"
          inputMode="decimal"
          value={values.minOrderValue}
          onChange={(e) => set('minOrderValue', e.target.value)}
          error={errors.minOrderValue}
          hint="Professional fee of the matching services. Blank = any amount."
        />

        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-night">Services</legend>
          <Checkbox
            id="coupon-limit-services"
            label="Only for some services"
            hint="Otherwise the coupon works for every service."
            checked={values.limitServices}
            onChange={(e) => set('limitServices', e.target.checked)}
          />
          {values.limitServices && (
            <div className="mt-3">
              <div
                role="group"
                aria-label="Services this coupon works for"
                aria-describedby={errors.serviceIds ? 'coupon-services-err' : undefined}
                className={`max-h-48 space-y-2 overflow-y-auto rounded-md border bg-white p-3 ${errors.serviceIds ? 'border-danger' : 'border-rule'}`}
              >
                {[...services.map((s) => ({ id: s.id, name: s.isActive ? s.name : `${s.name} (inactive)` })), ...removed.map((s) => ({ id: s.id, name: `${s.name} (removed)` }))].map((s) => (
                  <Checkbox
                    key={s.id}
                    id={`coupon-service-${s.id}`}
                    label={s.name}
                    checked={values.serviceIds.includes(s.id)}
                    onChange={(e) => set('serviceIds', e.target.checked ? [...values.serviceIds, s.id] : values.serviceIds.filter((id) => id !== s.id))}
                  />
                ))}
              </div>
              {errors.serviceIds && (
                <p id="coupon-services-err" className="mt-1.5 text-sm text-danger">
                  {errors.serviceIds}
                </p>
              )}
            </div>
          )}
        </fieldset>

        <Field id="coupon-starts" label="Starts on" type="date" value={values.startsOn} onChange={(e) => set('startsOn', e.target.value)} error={errors.startsOn} hint="Blank = straight away. Dates are IST." />
        <Field id="coupon-last-day" label="Last day" type="date" value={values.lastDay} onChange={(e) => set('lastDay', e.target.value)} error={errors.lastDay} hint="Works until the end of this day. Blank = no end." />
        <Field
          id="coupon-usage-limit"
          label="Total uses"
          inputMode="numeric"
          value={values.usageLimit}
          onChange={(e) => set('usageLimit', e.target.value)}
          error={errors.usageLimit}
          hint={coupon ? `Used ${coupon.usage.redemptions} time${coupon.usage.redemptions === 1 ? '' : 's'} so far. Blank = no limit.` : 'Blank = no limit.'}
        />
        <Field
          id="coupon-per-user"
          label="Uses per customer"
          inputMode="numeric"
          value={values.perUserLimit}
          onChange={(e) => set('perUserLimit', e.target.value)}
          error={errors.perUserLimit}
          hint="Blank = no limit."
        />
        <Checkbox
          id="coupon-active"
          className="sm:col-span-2"
          label="Active"
          hint="Customers can use it only while it is active."
          checked={values.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
        />
      </form>
    </Dialog>
  );
}
