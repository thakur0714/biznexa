'use client';

import { useEffect, useState, type Dispatch, type SetStateAction, type SubmitEvent } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { addDays, availabilityExceptionInputSchema, availabilityUpdateInputSchema, istDate, type ConsultantAvailability, type AvailabilityUpdateInput } from '@biznexa/types';
import { Button, Notice } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const inputClass = 'min-h-11 w-full rounded-md border border-rule bg-white px-3 text-sm';
type ExceptionKind = 'BLOCK_DAY' | 'BLOCK_HOURS' | 'EXTRA_HOURS';

export function ConsultantAvailabilityEditor() {
  const api = useApi();
  const { user } = useAuth();
  const [availability, setAvailability] = useState<ConsultantAvailability | null>(null);
  const [weekly, setWeekly] = useState<AvailabilityUpdateInput['weekly']>([]);
  const [settings, setSettings] = useState({ sessionMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 120 });
  const [date, setDate] = useState(() => addDays(istDate(new Date()), 1));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [exceptionKind, setExceptionKind] = useState<ExceptionKind>('BLOCK_DAY');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!user?.roles.includes('CONSULTANT')) return;
    let cancelled = false;
    api.call<ConsultantAvailability>((client) => client.GET('/api/consultants/me/availability'))
      .then((value) => {
        if (cancelled) return;
        setAvailability(value);
        setWeekly(value.weekly.map(({ weekday, startTime: start, endTime: end }) => ({ weekday, startTime: start, endTime: end })));
        setSettings({ sessionMinutes: value.sessionMinutes, bufferMinutes: value.bufferMinutes, minNoticeMinutes: value.minNoticeMinutes });
        setError('');
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load availability.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, user, retry]);

  if (!user) return null;
  if (!user.roles.includes('CONSULTANT')) return <NotAllowed />;

  async function saveSchedule(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = availabilityUpdateInputSchema.safeParse({ ...settings, weekly });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check your weekly schedule.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const value = await api.call<ConsultantAvailability>((client) => client.PUT('/api/consultants/me/availability', { body: parsed.data }));
      setAvailability(value);
      setWeekly(value.weekly.map(({ weekday, startTime: start, endTime: end }) => ({ weekday, startTime: start, endTime: end })));
      setNotice('Weekly availability saved.');
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not save availability.'); }
    finally { setSaving(false); }
  }

  async function addException(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const blocked = exceptionKind !== 'EXTRA_HOURS';
    const input = { date, isBlocked: blocked, ...(exceptionKind === 'BLOCK_DAY' ? {} : { startTime, endTime }) };
    const parsed = availabilityExceptionInputSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the date exception.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const value = await api.call<ConsultantAvailability>((client) => client.POST('/api/consultants/me/availability/exceptions', { body: parsed.data }));
      setAvailability(value);
      setNotice('Date exception saved.');
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not save this exception.'); }
    finally { setSaving(false); }
  }

  async function removeException(id: string) {
    setSaving(true); setError(''); setNotice('');
    try {
      const value = await api.call<ConsultantAvailability>((client) => client.DELETE('/api/consultants/me/availability/exceptions/{id}', { params: { path: { id } } }));
      setAvailability(value);
      setNotice('Date exception removed.');
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Could not remove this exception.'); }
    finally { setSaving(false); }
  }

  const updateWindow = (index: number, field: 'startTime' | 'endTime', value: string) => setWeekly((current) => current.map((window, i) => i === index ? { ...window, [field]: value } : window));

  return <main className="mx-auto max-w-4xl space-y-5" aria-labelledby="availability-heading">
    <header><h1 id="availability-heading" className="text-2xl font-semibold">Availability</h1><p className="mt-1 text-sm text-muted">Set your weekly consultation hours and one-off date exceptions. Times use India Standard Time.</p></header>
    {error && <Notice tone="error"><div className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { setLoading(true); setError(''); setRetry((n) => n + 1); }}>Retry</Button></div></Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
    {loading || !availability ? <output className="block">Loading availability…</output> : <>
      <form onSubmit={saveSchedule} className="space-y-5 rounded-lg border border-rule bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Weekly hours</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Session length (minutes)<input className={`${inputClass} mt-1`} type="number" min="15" max="240" step="5" value={settings.sessionMinutes} onChange={(event) => setSettings((v) => ({ ...v, sessionMinutes: Number(event.target.value) }))} /></label>
          <label className="text-sm font-medium">Buffer between sessions (minutes)<input className={`${inputClass} mt-1`} type="number" min="0" max="120" value={settings.bufferMinutes} onChange={(event) => setSettings((v) => ({ ...v, bufferMinutes: Number(event.target.value) }))} /></label>
          <label className="text-sm font-medium sm:col-span-2">Minimum notice (minutes)<input className={`${inputClass} mt-1 max-w-xs`} type="number" min="0" max="20160" value={settings.minNoticeMinutes} onChange={(event) => setSettings((v) => ({ ...v, minNoticeMinutes: Number(event.target.value) }))} /></label>
        </div>
        <div className="space-y-4">{DAYS.map((day, weekday) => <AvailabilityDay key={day} day={day} weekday={weekday} weekly={weekly} setWeekly={setWeekly} updateWindow={updateWindow} />)}</div>
        <Button variant="ink" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save weekly hours'}</Button>
      </form>

      <section className="space-y-4 rounded-lg border border-rule bg-white p-4 sm:p-6" aria-labelledby="exceptions-heading">
        <h2 id="exceptions-heading" className="text-lg font-semibold">Date exceptions</h2>
        {availability.exceptions.length ? <ul className="divide-y divide-rule">{availability.exceptions.map((exception) => <li key={exception.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><p className="font-medium">{exception.date} · {exception.isBlocked ? 'Blocked' : 'Extra hours'}</p><p className="text-sm text-muted">{exception.startTime}–{exception.endTime} IST</p></div><Button size="sm" variant="outline" disabled={saving} onClick={() => void removeException(exception.id)}>Remove</Button></li>)}</ul> : <p className="text-sm text-muted">No date exceptions yet.</p>}
        <form onSubmit={addException} className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Date (IST)<input className={`${inputClass} mt-1`} type="date" value={date} min={istDate(new Date())} onChange={(event) => setDate(event.target.value)} required /></label>
          <label className="text-sm font-medium">Change<select className={`${inputClass} mt-1`} value={exceptionKind} onChange={(event) => setExceptionKind(event.target.value as ExceptionKind)}><option value="BLOCK_DAY">Block the whole day</option><option value="BLOCK_HOURS">Block hours</option><option value="EXTRA_HOURS">Add extra hours</option></select></label>
          {exceptionKind !== 'BLOCK_DAY' && <><label className="text-sm font-medium">From<input className={`${inputClass} mt-1`} type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label><label className="text-sm font-medium">To<input className={`${inputClass} mt-1`} type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label></>}
          <div className="sm:col-span-2"><Button type="submit" variant="outline" disabled={saving}>Add date exception</Button></div>
        </form>
      </section>
    </>}
  </main>;
}

function AvailabilityDay({ day, weekday, weekly, setWeekly, updateWindow }: Readonly<{ day: string; weekday: number; weekly: AvailabilityUpdateInput['weekly']; setWeekly: Dispatch<SetStateAction<AvailabilityUpdateInput['weekly']>>; updateWindow: (index: number, field: 'startTime' | 'endTime', value: string) => void }>) {
  const windows = weekly.map((window, index) => ({ window, index })).filter(({ window }) => window.weekday === weekday);
  return <section className="rounded-md border border-rule p-3" aria-label={`${day} hours`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{day}</h3><Button size="sm" variant="outline" type="button" onClick={() => setWeekly((current) => [...current, { weekday, startTime: '09:00', endTime: '12:00' }])}>Add hours</Button></div>
    {windows.length ? <div className="mt-3 space-y-2">{windows.map(({ window, index }) => <div key={`${weekday}-${index}` // NOSONAR: rows have no id and are edited in place
      } className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"><label className="text-xs text-muted">From<input className={`${inputClass} mt-1`} type="time" value={window.startTime} onChange={(event) => updateWindow(index, 'startTime', event.target.value)} /></label><label className="text-xs text-muted">To<input className={`${inputClass} mt-1`} type="time" value={window.endTime === '24:00' ? '23:59' : window.endTime} onChange={(event) => updateWindow(index, 'endTime', event.target.value)} /></label><Button size="sm" variant="outline" type="button" aria-label={`Remove ${day} hours ${index + 1}`} onClick={() => setWeekly((current) => current.filter((_, i) => i !== index))}>Remove</Button></div>)}</div> : <p className="mt-2 text-sm text-muted">Not available</p>}
  </section>;
}
