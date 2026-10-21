'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ENTITY_TYPES,
  maskPan,
  OPTION_SOURCES,
  type EntityType,
} from '@biznexa/types';
import type { components } from '@biznexa/api-client';
import { Badge, Button, Dialog, EmptyState, Field, Notice, Select } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import { useApi } from '@biznexa/api-client/react';

type BusinessEntity = components['schemas']['BusinessEntity'];

function getEntityTypeLabel(type: string): string {
  return ENTITY_TYPES.find((t) => t.value === type)?.label ?? type;
}

function displayPan(pan: string | null | undefined): string {
  if (!pan) return '—';
  if (pan.includes('*')) return pan;
  return pan.length === 10 ? maskPan(pan) : pan;
}

function formatBusinessLocation(entity: BusinessEntity): string {
  if (!entity.address) return entity.state ?? 'No registered address';
  const secondLine = entity.address.line2 ? `, ${entity.address.line2}` : '';
  return `${entity.address.line1}${secondLine}, ${entity.address.city}, ${entity.address.state} - ${entity.address.pincode}`;
}

interface FormState {
  legalName: string;
  entityType: EntityType;
  pan: string;
  gstin: string;
  cin: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

const INITIAL_FORM: FormState = {
  legalName: '',
  entityType: 'PROPRIETORSHIP',
  pan: '',
  gstin: '',
  cin: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
};

export function CustomerBusinessesView() {
  const api = useApi();
  const [entities, setEntities] = useState<BusinessEntity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog state: Add / Edit
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<BusinessEntity | null>(null);
  const [formData, setFormData] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<BusinessEntity | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Success notice banner
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // Load business entities
  useEffect(() => {
    let cancelled = false;
    api
      .call((c) => c.GET('/api/business-entities'))
      .then(
        (res) => {
          if (!cancelled) {
            setEntities(res.items);
            setError(null);
            setLoading(false);
          }
        },
        (err: Error) => {
          if (!cancelled) {
            setError(err.message || 'Failed to load your business entities');
            setLoading(false);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const filteredEntities = useMemo(() => {
    if (!entities) return [];
    if (!searchQuery.trim()) return entities;
    const q = searchQuery.toLowerCase();
    return entities.filter(
      (b) =>
        b.legalName.toLowerCase().includes(q) ||
        b.gstin?.toLowerCase().includes(q) ||
        b.pan?.toLowerCase().includes(q) ||
        b.cin?.toLowerCase().includes(q) ||
        b.state?.toLowerCase().includes(q),
    );
  }, [entities, searchQuery]);

  const openAddModal = () => {
    setEditingEntity(null);
    setFormData(INITIAL_FORM);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditModal = (entity: BusinessEntity) => {
    setEditingEntity(entity);
    setFormData({
      legalName: entity.legalName,
      entityType: entity.entityType,
      pan: entity.pan ?? '',
      gstin: entity.gstin ?? '',
      cin: entity.cin ?? '',
      line1: entity.address?.line1 ?? '',
      line2: entity.address?.line2 ?? '',
      city: entity.address?.city ?? '',
      state: entity.address?.state ?? entity.state ?? '',
      pincode: entity.address?.pincode ?? '',
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    setSaving(true);
    setFormError(null);

    const legalName = formData.legalName.trim();
    if (!legalName || legalName.length < 2) {
      setFormError('Please enter a valid legal name (at least 2 characters)');
      setSaving(false);
      return;
    }

    const pan = formData.pan.trim().toUpperCase() || null;
    const gstin = formData.gstin.trim().toUpperCase() || null;
    const cin = formData.cin.trim().toUpperCase() || null;

    // Build address object if any address field is provided
    const line1 = formData.line1.trim();
    const city = formData.city.trim();
    const stateVal = formData.state.trim();
    const pincode = formData.pincode.trim();

    let address = null;
    if (line1 || city || stateVal || pincode) {
      if (!line1) {
        setFormError('Address line 1 is required when providing an address');
        setSaving(false);
        return;
      }
      if (!city) {
        setFormError('City is required when providing an address');
        setSaving(false);
        return;
      }
      if (!stateVal) {
        setFormError('State is required when providing an address');
        setSaving(false);
        return;
      }
      if (!/^[1-9]\d{5}$/.test(pincode)) {
        setFormError('Please enter a valid 6-digit PIN code');
        setSaving(false);
        return;
      }
      address = {
        line1,
        line2: formData.line2.trim() || null,
        city,
        state: stateVal,
        pincode,
      };
    }

    const bodyPayload = {
      legalName,
      entityType: formData.entityType,
      pan,
      gstin,
      cin,
      address,
      state: stateVal || null,
    };

    try {
      if (editingEntity) {
        const updated = await api.call((c) =>
          c.PUT('/api/business-entities/{id}', {
            params: { path: { id: editingEntity.id } },
            body: bodyPayload,
          }),
        );
        setEntities((prev) =>
          prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : [updated],
        );
        setBannerSuccess(`Updated business profile for "${updated.legalName}".`);
      } else {
        const created = await api.call((c) =>
          c.POST('/api/business-entities', {
            body: bodyPayload,
          }),
        );
        setEntities((prev) => (prev ? [created, ...prev] : [created]));
        setBannerSuccess(`Added new business entity "${created.legalName}".`);
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save business entity.';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  let mainContent: React.ReactNode;
  if (loading) {
    mainContent = <div className="py-12 text-center text-sm text-muted">Loading your saved businesses...</div>;
  } else if (!entities || entities.length === 0) {
    mainContent = (
      <div className="rounded-xl border border-rule bg-white p-8">
        <EmptyState
          title="No businesses saved yet"
          description="Add your company or firm details once. We will automatically prefill your legal filings, registrations, and invoices."
          action={<Button type="button" onClick={openAddModal}><Icon name="building" size={16} /><span>Add Your First Business</span></Button>}
        />
      </div>
    );
  } else if (filteredEntities.length === 0) {
    mainContent = (
      <div className="rounded-xl border border-rule bg-white p-8">
        <EmptyState
          title="No matching businesses"
          description={`No businesses match "${searchQuery}". Try a different search term.`}
          action={<Button type="button" variant="outline" onClick={() => setSearchQuery('')}>Clear Search</Button>}
        />
      </div>
    );
  } else {
    mainContent = (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filteredEntities.map((entity) => (
          <div key={entity.id} className="flex flex-col justify-between rounded-xl border border-rule bg-white p-5 shadow-sm transition-all hover:border-ink/20 hover:shadow-md">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-night" title={entity.legalName}>{entity.legalName}</h2>
                  <span className="mt-0.5 inline-block text-xs text-muted">Added on {new Date(entity.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <Badge tone="neutral">{getEntityTypeLabel(entity.entityType)}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-rule/60 bg-paper/40 p-3 text-xs">
                <div><span className="block text-muted">PAN</span><span className="font-mono font-medium text-night">{displayPan(entity.pan)}</span></div>
                <div><span className="block text-muted">GSTIN</span><span className="font-mono font-medium text-night">{entity.gstin ?? '—'}</span></div>
                {entity.cin && <div className="col-span-2"><span className="block text-muted">CIN / LLPIN</span><span className="font-mono font-medium text-night">{entity.cin}</span></div>}
              </div>
              <div className="text-xs text-muted"><div className="flex items-start gap-1.5"><span className="shrink-0 text-night font-medium">Location:</span><span>{formatBusinessLocation(entity)}</span></div></div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2 border-t border-rule/60 pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => openEditModal(entity)}>Edit</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setDeleteTarget(entity); setDeleteError(null); }} className="text-danger hover:border-danger hover:bg-danger/5">Delete</Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await api.call((c) =>
        c.DELETE('/api/business-entities/{id}', {
          params: { path: { id: deleteTarget.id } },
        }),
      );
      setEntities((prev) => (prev ? prev.filter((item) => item.id !== deleteTarget.id) : []));
      setBannerSuccess(`Deleted business "${deleteTarget.legalName}".`);
      setDeleteTarget(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete business entity.';
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  let submitLabel = 'Add Business';
  if (saving) submitLabel = 'Saving...';
  else if (editingEntity) submitLabel = 'Save Changes';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-night sm:text-3xl">My Businesses</h1>
          <p className="mt-1 text-sm text-muted">
            Save company details to automatically prefill service applications and tax invoices.
          </p>
        </div>
        <div>
          <Button type="button" onClick={openAddModal}>
            <Icon name="building" size={16} />
            <span>Add Business</span>
          </Button>
        </div>
      </div>

      {bannerSuccess && (
        <Notice tone="success">{bannerSuccess}</Notice>
      )}

      {error && (
        <Notice tone="error">{error}</Notice>
      )}

      {/* Search Bar */}
      {entities && entities.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-sm">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
              <Icon name="search" size={16} />
            </span>
            <input
              type="text"
              placeholder="Search by name, GSTIN, PAN, state..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-md border border-rule bg-white pl-9 pr-3 text-sm text-night placeholder:text-muted/70 focus:border-ink focus:outline-none"
            />
          </div>
          <div className="text-xs font-medium text-muted">
            {filteredEntities.length} of {entities.length} saved business{entities.length === 1 ? '' : 'es'}
          </div>
        </div>
      )}

      {/* Main Content */}
      {mainContent}

      {/* Add / Edit Modal */}
      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        title={editingEntity ? 'Edit Business Entity' : 'Add Business Entity'}
        description="Provide your legal business registration details. PAN and GSTIN are verified against statutory format rules."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {submitLabel}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4 max-h-[65vh] overflow-y-auto px-1">
          {formError && (
            <Notice tone="error">{formError}</Notice>
          )}

          <Field
            id="biz-legal-name"
            label="Legal Business Name *"
            value={formData.legalName}
            onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
            placeholder="e.g. Acme Technologies Private Limited"
            required
          />

          <Select
            id="biz-entity-type"
            label="Business Structure / Entity Type *"
            value={formData.entityType}
            onChange={(e) => setFormData({ ...formData, entityType: e.target.value as EntityType })}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id="biz-pan"
              label="Business PAN"
              value={formData.pan}
              onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
              placeholder="ABCDE1234F"
              maxLength={10}
              hint="10-character PAN card number"
            />

            <Field
              id="biz-gstin"
              label="GSTIN"
              value={formData.gstin}
              onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
              placeholder="07AAAAA0000A1Z5"
              maxLength={15}
              hint="15-character GST identification number"
            />
          </div>

          <Field
            id="biz-cin"
            label="CIN or LLPIN (if applicable)"
            value={formData.cin}
            onChange={(e) => setFormData({ ...formData, cin: e.target.value.toUpperCase() })}
            placeholder="e.g. U74999PB2020PTC012345 or AAB-1234"
            maxLength={21}
            hint="For Private Limited, OPC, Public Limited or LLP firms"
          />

          <div className="border-t border-rule pt-4">
            <h3 className="text-sm font-semibold text-night mb-2">Registered Address (Optional)</h3>
            <div className="space-y-3">
              <Field
                id="biz-address-1"
                label="Address Line 1"
                value={formData.line1}
                onChange={(e) => setFormData({ ...formData, line1: e.target.value })}
                placeholder="Building, street, or plot number"
              />

              <Field
                id="biz-address-2"
                label="Address Line 2 (Optional)"
                value={formData.line2}
                onChange={(e) => setFormData({ ...formData, line2: e.target.value })}
                placeholder="Suite, unit, floor, landmark"
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field
                  id="biz-city"
                  label="City"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="City"
                />

                <Select
                  id="biz-state"
                  label="State / UT"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                >
                  <option value="">Select state...</option>
                  {OPTION_SOURCES.states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>

                <Field
                  id="biz-pincode"
                  label="PIN Code"
                  value={formData.pincode}
                  onChange={(e) => setFormData({ ...formData, pincode: e.target.value.replaceAll(/\D/g, '').slice(0, 6) })}
                  placeholder="110001"
                  maxLength={6}
                />
              </div>
            </div>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Business Entity?"
        description={`Are you sure you want to delete "${deleteTarget?.legalName}"? This business entity will no longer appear for prefilling applications or invoices.`}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {deleting ? 'Deleting...' : 'Yes, Delete Business'}
            </Button>
          </>
        }
      >
        {deleteError && (
          <div className="mb-4">
            <Notice tone="error">{deleteError}</Notice>
          </div>
        )}
        <p className="text-sm text-muted">
          Existing submitted applications and past invoices that referenced this business will retain their historic records.
        </p>
      </Dialog>
    </div>
  );
}
