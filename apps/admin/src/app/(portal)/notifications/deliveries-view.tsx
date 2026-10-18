'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button, Field, Notice, Select, useToast, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_EVENTS,
  formatDateTime,
  istDay,
  type NotificationDelivery,
  type NotificationDeliveryPage,
  type NotificationDeliveryStatus,
} from '@biznexa/types';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

const DELIVERY_STATUS_TONE: Record<NotificationDeliveryStatus, Tone> = {
  QUEUED: 'info',
  SENT: 'accent',
  DELIVERED: 'success',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};

export function DeliveriesView() {
  const { user } = useAuth();
  const item = findNavItem('notifications');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <DeliveriesPage />;
}

/** Delivery log (M6.3): every notification × channel with its status; FAILED ones can be sent again. */
function DeliveriesPage() {
  const api = useApi();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();

  const filter = useMemo(
    () => ({
      status: params.get('status') || undefined,
      channel: params.get('channel') || undefined,
      event: params.get('event') || undefined,
      user: params.get('user') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      page: Number(params.get('page')) || 1,
      limit: 50,
    }),
    [params],
  );

  const [data, setData] = useState<NotificationDeliveryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInput, setUserInput] = useState(filter.user ?? '');
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    let cancelled = false;
    api
      .call((c) => c.GET('/api/admin/notifications/deliveries', { params: { query: filter as unknown as Record<string, never> } }))
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, filter]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    router.push('?' + next.toString());
  };

  const retry = async (d: NotificationDelivery) => {
    setRetrying(d.id);
    try {
      const updated = await api.call((c) => c.POST('/api/admin/notifications/deliveries/{id}/retry', { params: { path: { id: d.id } } }));
      setData((prev) => (prev ? { ...prev, items: prev.items.map((i) => (i.id === d.id ? updated : i)) } : prev));
      toast('Queued to send again', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Notification log</h1>
        <p className="text-sm text-muted">Every email, SMS, push and in-app message, and what happened to it. Message content is not shown.</p>
      </div>

      <form
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          updateFilter('user', userInput.trim());
        }}
      >
        <Select id="filter-status" label="Status" value={filter.status ?? ''} onChange={(e) => updateFilter('status', e.target.value)}>
          <option value="">All</option>
          {NOTIFICATION_DELIVERY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select id="filter-channel" label="Channel" value={filter.channel ?? ''} onChange={(e) => updateFilter('channel', e.target.value)}>
          <option value="">All</option>
          {NOTIFICATION_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select id="filter-event" label="Event" value={filter.event ?? ''} onChange={(e) => updateFilter('event', e.target.value)}>
          <option value="">All</option>
          {NOTIFICATION_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </Select>
        <Field
          id="filter-user"
          label="User"
          placeholder="Name, email, mobile or id"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onBlur={() => userInput.trim() !== (filter.user ?? '') && updateFilter('user', userInput.trim())}
        />
        <Field
          id="filter-from"
          label="From (IST)"
          type="date"
          value={filter.from ? istDay(filter.from) : ''}
          onChange={(e) => updateFilter('from', e.target.value ? new Date(e.target.value + 'T00:00:00+05:30').toISOString() : '')}
        />
        <Field
          id="filter-to"
          label="To (IST)"
          type="date"
          value={filter.to ? istDay(filter.to) : ''}
          onChange={(e) => updateFilter('to', e.target.value ? new Date(e.target.value + 'T23:59:59.999+05:30').toISOString() : '')}
        />
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b text-muted">
              <th className="py-2 pr-4 font-medium">Queued</th>
              <th className="py-2 pr-4 font-medium">User</th>
              <th className="py-2 pr-4 font-medium">Event</th>
              <th className="py-2 pr-4 font-medium">Channel</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Tries</th>
              <th className="py-2 pr-4 font-medium">Last update</th>
              <th className="py-2 pr-4 font-medium">Reason</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="align-top">
            {loading && !data ? (
              <tr>
                <td colSpan={9} className="py-4 text-center text-muted">
                  Loading...
                </td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={9} className="py-4 text-center text-muted">
                  No deliveries match these filters.
                </td>
              </tr>
            ) : (
              data.items.map((d) => (
                <tr key={d.id} className="border-b">
                  <td className="py-3 pr-4">
                    {formatDateTime(d.createdAt)}
                    {d.sendAt && <div className="text-xs text-muted">sends {formatDateTime(d.sendAt)}</div>}
                  </td>
                  <td className="py-3 pr-4">
                    <div>{d.userName ?? '—'}</div>
                    <div className="text-xs text-muted">{d.userEmail ?? d.userId}</div>
                  </td>
                  <td className="py-3 pr-4">{d.event}</td>
                  <td className="py-3 pr-4">{d.channel}</td>
                  <td className="py-3 pr-4">
                    <Badge tone={DELIVERY_STATUS_TONE[d.status]}>{d.status}</Badge>
                  </td>
                  <td className="py-3 pr-4">{d.attempts}</td>
                  <td className="py-3 pr-4">{formatDateTime(d.deliveredAt ?? d.failedAt ?? d.sentAt ?? d.updatedAt)}</td>
                  <td className="max-w-xs truncate py-3 pr-4 text-xs" title={d.lastError ?? undefined}>
                    {d.lastError ?? ''}
                  </td>
                  <td className="py-3">
                    {d.status === 'FAILED' && (
                      <Button size="sm" variant="outline" disabled={retrying === d.id} onClick={() => retry(d)}>
                        {retrying === d.id ? 'Retrying…' : 'Retry'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div className="flex gap-4">
          <Button disabled={data.page === 1} onClick={() => updateFilter('page', String(data.page - 1))}>
            Previous
          </Button>
          <span className="self-center text-sm">
            Page {data.page} of {data.pages} · {data.total} deliveries
          </span>
          <Button disabled={data.page === data.pages} onClick={() => updateFilter('page', String(data.page + 1))}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
