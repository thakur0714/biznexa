'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { formatDateTime, formatINR, type ConsultantPortalApplications, type ConsultantPortalBookings, type ConsultantPortalConversations, type ConsultantPortalEarnings } from '@biznexa/types';
import { Button, Notice } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';

type Section = 'bookings' | 'applications' | 'messages' | 'earnings';
const titles: Record<Section, string> = { bookings: 'My bookings', applications: 'Assigned applications', messages: 'Messages', earnings: 'Earnings' };

export function ConsultantPortalView({ section }: { section: Section }) {
  const api = useApi();
  const { user } = useAuth();
  const [data, setData] = useState<ConsultantPortalBookings | ConsultantPortalApplications | ConsultantPortalConversations | ConsultantPortalEarnings | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.roles.includes('CONSULTANT')) return;
    let cancelled = false;
    const load = async () => {
      const result = section === 'bookings'
        ? await api.call<ConsultantPortalBookings>((c) => c.GET('/api/consultants/me/portal/bookings'))
        : section === 'applications'
          ? await api.call<ConsultantPortalApplications>((c) => c.GET('/api/consultants/me/portal/applications'))
          : section === 'messages'
            ? await api.call<ConsultantPortalConversations>((c) => c.GET('/api/consultants/me/portal/conversations'))
            : await api.call<ConsultantPortalEarnings>((c) => c.GET('/api/consultants/me/portal/earnings'));
      if (!cancelled) { setData(result); setError(''); }
    };
    load().catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this section.'); });
    return () => { cancelled = true; };
  }, [api, user, section, retry]);

  if (!user) return null;
  if (!user.roles.includes('CONSULTANT')) return <NotAllowed />;
  async function recordOutcome(id: string, status: 'COMPLETED' | 'NO_SHOW') {
    setBusy(id); setError('');
    try {
      await api.call((c) => c.POST('/api/bookings/{id}/outcome', { params: { path: { id } }, body: { status } }));
      setRetry((n) => n + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update booking outcome.'); }
    finally { setBusy(null); }
  }

  return <main className="mx-auto max-w-5xl space-y-5" aria-labelledby="consultant-portal-heading">
    <header><h1 id="consultant-portal-heading" className="text-2xl font-semibold">{titles[section]}</h1><p className="mt-1 text-sm text-muted">Information and actions for your own consultations and assignments.</p></header>
    {error && <Notice tone="error"><div className="flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry</Button></div></Notice>}
    {!data ? <p role="status">Loading {titles[section].toLowerCase()}…</p> : section === 'bookings' ? <Bookings data={data as ConsultantPortalBookings} busy={busy} onOutcome={recordOutcome} />
      : section === 'applications' ? <Applications data={data as ConsultantPortalApplications} />
        : section === 'messages' ? <Messages data={data as ConsultantPortalConversations} /> : <Earnings data={data as ConsultantPortalEarnings} />}
  </main>;
}

function Bookings({ data, busy, onOutcome }: { data: ConsultantPortalBookings; busy: string | null; onOutcome: (id: string, status: 'COMPLETED' | 'NO_SHOW') => void }) {
  const upcoming = data.items.filter((b) => b.upcoming);
  const past = data.items.filter((b) => !b.upcoming);
  const rows = (items: typeof data.items) => items.length ? <ul className="divide-y divide-rule rounded-lg border border-rule bg-white">{items.map((b) => <li key={b.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
    <div><p className="font-semibold">{b.customerName} <span className="font-normal text-muted">· {b.code}</span></p><p className="mt-1 text-sm text-muted">{b.type} · {formatDateTime(b.startAt)} · {b.status.replaceAll('_', ' ')}</p></div>
    <div className="flex flex-wrap items-center gap-2">{b.meetingLink && b.status === 'CONFIRMED' && <a className="rounded-md bg-ink px-3 py-2 text-sm text-white" href={b.meetingLink} target="_blank" rel="noreferrer">Join session</a>}{b.status === 'CONFIRMED' && !b.upcoming && <><Button size="sm" disabled={busy === b.id} onClick={() => onOutcome(b.id, 'COMPLETED')}>Mark completed</Button><Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => onOutcome(b.id, 'NO_SHOW')}>Mark no-show</Button></>}</div>
  </li>)}</ul> : <p className="rounded-lg border border-dashed border-rule p-5 text-sm text-muted">No bookings here yet.</p>;
  return <div className="space-y-6"><section className="space-y-3"><h2 className="font-semibold">Upcoming</h2>{rows(upcoming)}</section><section className="space-y-3"><h2 className="font-semibold">Past</h2>{rows(past)}</section></div>;
}

function Applications({ data }: { data: ConsultantPortalApplications }) { return data.items.length ? <ul className="divide-y divide-rule rounded-lg border border-rule bg-white">{data.items.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-3 p-4"><div><p className="font-semibold">{a.serviceName} <span className="font-normal text-muted">· {a.code}</span></p><p className="mt-1 text-sm text-muted">{a.customerName} · {a.status.replaceAll('_', ' ')} · {formatDateTime(a.createdAt)}</p></div><Link className="text-sm font-medium text-link underline" href={`/applications/${a.id}`}>View application and thread</Link></li>)}</ul> : <p className="rounded-lg border border-dashed border-rule p-5 text-sm text-muted">No applications are assigned to you.</p>; }
function Messages({ data }: { data: ConsultantPortalConversations }) { return data.items.length ? <ul className="divide-y divide-rule rounded-lg border border-rule bg-white">{data.items.map((c) => <li key={c.applicationId} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{c.serviceName} · {c.applicationCode}</p><p className="mt-1 text-sm text-muted">{c.unreadCount} unread {c.unreadCount === 1 ? 'message' : 'messages'}</p></div><Link className="text-sm font-medium text-link underline" href={`/applications/${c.applicationId}`}>Open conversation</Link></li>)}</ul> : <p className="rounded-lg border border-dashed border-rule p-5 text-sm text-muted">No application conversations yet.</p>; }
function Earnings({ data }: { data: ConsultantPortalEarnings }) { return <div className="space-y-5"><p className="text-sm text-muted">Commission: {data.commissionPercent}% · Completed bookings only</p><section className="overflow-x-auto rounded-lg border border-rule bg-white"><table className="w-full min-w-[600px] text-left text-sm"><thead><tr className="border-b border-rule"><th className="p-3">Month</th><th className="p-3">Bookings</th><th className="p-3">Fees</th><th className="p-3">Commission</th><th className="p-3">Your earnings</th></tr></thead><tbody>{data.monthlyTotals.map((m) => <tr key={m.month} className="border-b border-rule last:border-0"><td className="p-3">{m.month}</td><td className="p-3">{m.bookings}</td><td className="p-3">{formatINR(m.fee, true)}</td><td className="p-3">{formatINR(m.commission, true)}</td><td className="p-3 font-semibold">{formatINR(m.net, true)}</td></tr>)}{!data.monthlyTotals.length && <tr><td colSpan={5} className="p-5 text-center text-muted">No completed bookings yet.</td></tr>}</tbody></table></section><h2 className="font-semibold">Completed booking earnings</h2><ul className="divide-y divide-rule rounded-lg border border-rule bg-white">{data.items.map((i) => <li key={i.bookingId} className="flex flex-wrap justify-between gap-2 p-4 text-sm"><span>{i.code} · {formatDateTime(i.completedAt)}</span><span>{formatINR(i.fee, true)} − {formatINR(i.commission, true)} = <strong>{formatINR(i.net, true)}</strong></span></li>)}</ul></div>; }
