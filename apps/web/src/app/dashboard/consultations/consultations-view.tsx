'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BOOKING_CHANGE_WINDOW_HOURS, addDays, formatDate, formatINR, istDate, type BookingView, type PublicConsultantSlots } from '@biznexa/types';
import { useApi } from '@biznexa/api-client/react';
import { Badge, Button, Dialog, EmptyState, Notice } from '@biznexa/ui';

type Tab = 'UPCOMING' | 'PAST';
const CANCEL_WINDOW = BOOKING_CHANGE_WINDOW_HOURS * 60 * 60 * 1000;

function statusLabel(status: BookingView['status']) {
  return status.replaceAll('_', ' ').toLowerCase().replaceAll(/\b\w/g, (c) => c.toUpperCase());
}

function consultationTone(status: BookingView['status']) {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'success' as const;
  if (status === 'CANCELLED') return 'neutral' as const;
  return 'warning' as const;
}

export function ConsultationsView() {
  const api = useApi();
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('UPCOMING');
  const [now, setNow] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [slots, setSlots] = useState<PublicConsultantSlots['slots']>([]);
  const [slotValue, setSlotValue] = useState('');
  const [cancelDialogBooking, setCancelDialogBooking] = useState<BookingView | null>(null);
  const [cancelError, setCancelError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const result = await api.call((client) => client.GET('/api/bookings'));
      setBookings(result.items);
      setNow(Date.now());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your consultations.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    let live = true;
    api.call((client) => client.GET('/api/bookings')).then((result) => {
      if (!live) return;
      setBookings(result.items);
      setNow(Date.now());
      setError('');
      setLoading(false);
    }).catch((cause: unknown) => {
      if (!live) return;
      setError(cause instanceof Error ? cause.message : 'Could not load your consultations.');
      setLoading(false);
    });
    return () => { live = false; };
  }, [api]);

  const visible = useMemo(() => {
    return bookings.filter((booking) => {
      const scheduled = ['CONFIRMED', 'PENDING_PAYMENT'].includes(booking.status) && new Date(booking.startAt).getTime() >= now;
      return tab === 'UPCOMING' ? scheduled : !scheduled;
    });
  }, [bookings, tab, now]);

  function cancel(booking: BookingView) {
    setCancelError('');
    setCancelDialogBooking(booking);
  }

  async function confirmCancel() {
    if (!cancelDialogBooking) return;
    setBusyId(cancelDialogBooking.id);
    setCancelError('');
    try {
      await api.call((client) => client.POST('/api/bookings/{id}/cancel', { params: { path: { id: cancelDialogBooking.id } }, body: {} }));
      setCancelDialogBooking(null);
      await refresh();
    } catch (cause) {
      setCancelError(cause instanceof Error ? cause.message : 'Could not cancel this consultation.');
    } finally { setBusyId(null); }
  }

  async function loadSlots(booking: BookingView) {
    setBusyId(booking.id);
    setError('');
    try {
      const from = addDays(istDate(new Date()), 1);
      const result = await api.call((client) => client.GET('/api/public/consultants/{slug}/slots', {
        params: { path: { slug: booking.consultant.slug }, query: { from, to: addDays(from, 13) } },
      }));
      setSlots(result.slots.filter((slot) => new Date(slot.startAt).getTime() >= Date.now() + CANCEL_WINDOW));
      setSlotValue('');
      setRescheduling(booking.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load available times.');
    } finally { setBusyId(null); }
  }

  async function reschedule(booking: BookingView) {
    if (!slotValue) return;
    setBusyId(booking.id);
    setError('');
    try {
      await api.call((client) => client.POST('/api/bookings/{id}/reschedule', { params: { path: { id: booking.id } }, body: { startAt: slotValue } }));
      setRescheduling(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reschedule this consultation.');
    } finally { setBusyId(null); }
  }

  return (
    <main className="min-w-0" aria-labelledby="consultations-heading">
      <div className="mb-6"><Link href="/dashboard" className="text-sm font-medium text-muted hover:text-ink">← Back to dashboard</Link></div>
      <header className="mb-6">
        <h1 id="consultations-heading" className="text-2xl font-bold tracking-[-0.025em]">My Consultations</h1>
        <p className="mt-1 text-sm text-muted">View your sessions, join confirmed consultations, and manage bookings.</p>
      </header>
      <div className="mb-5 flex gap-2" role="tablist" aria-label="Consultations">
        {(['UPCOMING', 'PAST'] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} className={`rounded-md px-4 py-2 text-sm font-medium ${tab === value ? 'bg-ink text-white' : 'border border-rule bg-white text-ink'}`} onClick={() => setTab(value)}>{value === 'UPCOMING' ? 'Upcoming' : 'Past'}</button>)}
      </div>
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      {loading && <output className="block">Loading consultations…</output>}
      {!loading && visible.length === 0 && (
        <EmptyState title={tab === 'UPCOMING' ? 'No upcoming consultations' : 'No past consultations'} description={tab === 'UPCOMING' ? 'Your confirmed and upcoming bookings will appear here.' : 'Completed and cancelled bookings will appear here.'} />
      )}
      {!loading && visible.length > 0 && <div className="space-y-4">{visible.map((booking) => {
        const canManage = booking.status === 'CONFIRMED' && new Date(booking.startAt).getTime() - now >= CANCEL_WINDOW;
        return <article key={booking.id} className="rounded-lg border border-rule bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold">{booking.consultant.name}</h2><p className="mt-1 text-sm text-muted">{formatDate(booking.startAt)} · {new Date(booking.startAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })} IST</p><p className="mt-1 text-xs text-muted">{booking.code} · {booking.type.replaceAll('_', ' ')} · {formatINR(booking.fee)}</p></div>
            <Badge tone={consultationTone(booking.status)}>{statusLabel(booking.status)}</Badge>
          </div>
          {booking.status === 'CONFIRMED' && booking.meetingLink && new Date(booking.endAt).getTime() >= now && <a className="mt-4 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-night" href={booking.meetingLink} target="_blank" rel="noreferrer">Join consultation</a>}
          {booking.status === 'COMPLETED' && <Link className="mt-4 inline-flex rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink hover:bg-paper" href={`/dashboard/consultations/${booking.id}/review`}>Leave review</Link>}
          {booking.status === 'CONFIRMED' && <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" disabled={!canManage || busyId === booking.id} onClick={() => void loadSlots(booking)}>Reschedule</Button>
            <Button variant="outline" disabled={!canManage || busyId === booking.id} onClick={() => cancel(booking)}>Cancel</Button>
            {!canManage && <span className="self-center text-xs text-muted">{`Changes are available until ${BOOKING_CHANGE_WINDOW_HOURS} hours before the session.`}</span>}
          </div>}
          {rescheduling === booking.id && <div className="mt-4 rounded-md bg-paper p-4">
            <label htmlFor={`slot-${booking.id}`} className="mb-2 block text-sm font-medium">Available times (Asia/Kolkata)</label>
            <select id={`slot-${booking.id}`} className="w-full rounded-md border border-rule bg-white p-2 text-sm" value={slotValue} onChange={(event) => setSlotValue(event.target.value)}>
              <option value="">Choose a new time</option>{slots.map((slot) => <option key={slot.startAt} value={slot.startAt}>{slot.date} · {slot.time} IST</option>)}
            </select>
            {!slots.length && <p className="mt-2 text-sm text-muted">No available times in the next 14 days.</p>}
            <div className="mt-3 flex gap-2"><Button disabled={!slotValue || busyId === booking.id} onClick={() => void reschedule(booking)}>Confirm new time</Button><Button variant="outline" onClick={() => setRescheduling(null)}>Keep current time</Button></div>
          </div>}
        </article>;
      })}</div>}
      <Dialog
        open={!!cancelDialogBooking}
        onClose={() => { if (busyId !== cancelDialogBooking?.id) setCancelDialogBooking(null); }}
        title="Cancel consultation?"
        description={cancelDialogBooking ? `${cancelDialogBooking.consultant.name} · ${formatDate(cancelDialogBooking.startAt)} · ${new Date(cancelDialogBooking.startAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })} IST` : ''}
        footer={<>
          <Button type="button" variant="outline" onClick={() => setCancelDialogBooking(null)} disabled={busyId === cancelDialogBooking?.id}>Keep booking</Button>
          <Button type="button" className="bg-danger text-white hover:bg-danger/90" onClick={() => void confirmCancel()} disabled={busyId === cancelDialogBooking?.id}>{busyId === cancelDialogBooking?.id ? 'Cancelling...' : 'Cancel consultation'}</Button>
        </>}
      >
        {cancelError && <div className="mb-4"><Notice tone="error">{cancelError}</Notice></div>}
        <p className="text-sm text-muted">The booking fee is not refunded automatically.</p>
      </Dialog>
    </main>
  );
}
