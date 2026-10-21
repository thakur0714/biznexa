'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Notice, Select } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { APPLICATION_STATUS_LABEL, allowedNext, type ApplicationStatus, type ApplicationTransitionInput } from '@biznexa/types';

export function StatusForm({ id, current, stages }: { id: string, current: ApplicationStatus, stages: { id: string, name: string }[] }) {
  const api = useApi();
  const router = useRouter();
  
  const [to, setTo] = useState<ApplicationStatus>(current);
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const [stage, setStage] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextAllowed = useMemo(() => {
    return [current, ...allowedNext('application', current)] as ApplicationStatus[];
  }, [current]);

  const requiresReason = to === 'CANCELLED' || to === 'ON_HOLD';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (to === current && !stage) return;
    if (requiresReason && !note.trim()) {
      setError('A reason is required for ' + APPLICATION_STATUS_LABEL[to]);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body: ApplicationTransitionInput = {
        to,
        note: note || undefined,
        visibleToCustomer: visible,
        stageId: stage || undefined,
      };
      await api.call(c => c.POST('/api/admin/applications/{id}/status', { params: { path: { id } }, body }));
      router.refresh();
      setTo(to);
      setNote('');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-4 border border-rule rounded-md bg-paper">
      <h2 className="font-semibold mb-2">Update Status</h2>
      {error && <Notice tone="error">{error}</Notice>}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select id="status-field" label="Status" value={to} onChange={e => setTo(e.target.value as ApplicationStatus)}>
          {nextAllowed.map(s => (
            <option key={s} value={s}>{APPLICATION_STATUS_LABEL[s] || s}</option>
          ))}
          {!nextAllowed.includes('CANCELLED') && <option value="CANCELLED">Cancel (Admin)</option>}
        </Select>

        {stages.length > 0 && (
          <Select id="stage-field" label="Stage" value={stage} onChange={e => setStage(e.target.value)}>
            <option value="">No stage selected</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}
      </div>

      <Field id="note-field"
        label="Note / Reason" 
        value={note} 
        onChange={e => setNote(e.target.value)} 
        hint={requiresReason ? "Required for the selected status" : "Optional internal or customer-visible note"}
      />
      
      <div className="flex items-center gap-2">
        <input 
          type="checkbox" 
          id="visible" 
          checked={visible} 
          onChange={e => setVisible(e.target.checked)} 
        />
        <label htmlFor="visible" className="text-sm">Visible to customer</label>
      </div>

      <Button variant="ink" type="submit" disabled={saving}>
        {saving ? 'Updating...' : 'Update'}
      </Button>
    </form>
  );
}
