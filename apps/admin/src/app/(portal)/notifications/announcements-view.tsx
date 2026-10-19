'use client';

import { useState, useEffect } from 'react';
import { Button, Field, Notice, Select, TextArea, Checkbox, useToast } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import type { AnnouncementSegment } from '@biznexa/types';
import type { components } from '@biznexa/api-client';

export function AnnouncementsView() {
  const api = useApi();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [segmentType, setSegmentType] = useState<'ALL_CUSTOMERS' | 'ACTIVE_APPLICATION_CATEGORY' | 'EXPIRING_CERTIFICATE'>('ALL_CUSTOMERS');
  const [categoryId, setCategoryId] = useState('');
  const [days, setDays] = useState('30');
  const [channels, setChannels] = useState<string[]>(['IN_APP']);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [categories, setCategories] = useState<components['schemas']['AdminCategoryList'] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState('');

  useEffect(() => {
    async function loadCategories() {
      setCategoriesLoading(true); setCategoriesError('');
      try {
        const list = await api.call((c) => c.GET('/api/admin/catalogue/categories'));
        setCategories(list);
      } catch (err) { setCategoriesError('Could not load categories.'); }
      finally { setCategoriesLoading(false); }
    }
    loadCategories();
  }, [api]);

  const segment: AnnouncementSegment = segmentType === 'ALL_CUSTOMERS' ? { type: 'ALL_CUSTOMERS' } : segmentType === 'ACTIVE_APPLICATION_CATEGORY' ? { type: 'ACTIVE_APPLICATION_CATEGORY', categoryId } : { type: 'EXPIRING_CERTIFICATE', days: Number(days) };
  const toggle = (value: string) => setChannels((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  async function countRecipients() {
    setBusy(true); setError('');
    try {
      const result = await api.call((client) => client.POST('/api/admin/notifications/announcements/count', { body: { segment } }));
      setCount(result.recipients);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not count recipients.'); }
    finally { setBusy(false); }
  }
  async function send() {
    if (count === null || !channels.length) return;
    setBusy(true); setError('');
    try {
      const result = await api.call((client) => client.POST('/api/admin/notifications/announcements', { body: { title, body, segment, channels: channels as ('IN_APP' | 'EMAIL' | 'PUSH' | 'SMS')[] } }));
      toast(`Announcement queued for ${result.recipients} customers.`, 'success');
      setCount(null); setTitle(''); setBody('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not queue the announcement.'); }
    finally { setBusy(false); }
  }

  return <section className="max-w-3xl space-y-5" aria-label="Manual announcement">
    <h2 className="text-xl font-semibold">Manual announcement</h2>
    <p className="text-sm text-muted-foreground">Announcements are marketing messages. Customers who opted out are excluded.</p>
    <Field id="announcement-title" label="Title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
    <TextArea id="announcement-body" label="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} />
    <Select id="announcement-audience" label="Audience" value={segmentType} onChange={(e) => { setSegmentType(e.target.value as typeof segmentType); setCount(null); }}>
      <option value="ALL_CUSTOMERS">All customers</option><option value="ACTIVE_APPLICATION_CATEGORY">Active applications in category</option><option value="EXPIRING_CERTIFICATE">Certificate expiring within N days</option>
    </Select>
    {segmentType === 'ACTIVE_APPLICATION_CATEGORY' && (
      <>
        <Select id="announcement-category" label="Category" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setCount(null); }} disabled={categoriesLoading || !!categoriesError}>
          <option value="">{categoriesLoading ? 'Loading...' : 'Select a category'}</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {categoriesError && (
          <p className="text-sm text-danger mt-1">
            {categoriesError}
          </p>
        )}
      </>
    )}
    {segmentType === 'EXPIRING_CERTIFICATE' && <Field id="announcement-days" label="Days until expiry" type="number" min={1} max={365} value={days} onChange={(e) => { setDays(e.target.value); setCount(null); }} />}
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Channels</legend>{['IN_APP', 'EMAIL', 'PUSH', 'SMS'].map((channel) => <Checkbox id={`announcement-${channel.toLowerCase()}`} key={channel} label={channel} checked={channels.includes(channel)} onChange={() => toggle(channel)} />)}<p className="text-xs text-muted-foreground">SMS is sent only when an active DLT template is configured.</p></fieldset>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="flex items-center gap-3"><Button variant="outline" disabled={busy || (segmentType === 'ACTIVE_APPLICATION_CATEGORY' && !categoryId)} onClick={countRecipients}>Show recipient count</Button>{count !== null && <span role="status">{count} recipients</span>}</div>
    <Button disabled={busy || count === null || !title.trim() || !body.trim() || !channels.length} onClick={send}>Queue announcement</Button>
  </section>;
}
