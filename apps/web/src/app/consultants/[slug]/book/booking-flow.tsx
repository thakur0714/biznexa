'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, formatINR, istDate, type BookingCheckout, type BookingView, type ConsultationType, type PublicConsultantSlots } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Breadcrumbs, Button, LinkButton, Notice } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { openRazorpayCheckout, type RazorpaySuccess } from '@/lib/razorpay';

const TYPE_LABEL: Record<ConsultationType, string> = { AUDIO: 'Audio call', VIDEO: 'Video call', CHAT: 'Chat', MEETING: 'In person' };
const money = (paise: number) => formatINR(paise, true);
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const timeLabel = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const message = (e: unknown) => (e instanceof ClientApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/** Poll every 2 s for up to 2 minutes while the webhook confirms the payment. */
const POLL_MS = 2000;
const GIVE_UP_MS = 120_000;

type Phase = 'pick' | 'held' | 'confirming' | 'confirmed';

/**
 * Pick type → date → slot, hold it (10 minutes), pay (M8.8). The booking is shown as confirmed only when
 * `GET /api/bookings/{id}` says CONFIRMED, i.e. after the gateway's webhook; Checkout's success is a hint.
 * With the mock gateway (development) no payment window opens: "Complete test payment" plays the gateway.
 */
export function BookingFlow({ slug, initial }: Readonly<{ slug: string; initial: PublicConsultantSlots }>) {
  const api = useApi();
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [data, setData] = useState(initial);
  const [type, setType] = useState<ConsultationType | null>(() => {
    const t = params.get('type') as ConsultationType | null;
    if (t && initial.consultant.consultationTypes.includes(t)) return t;
    if (initial.consultant.consultationTypes.length === 1) return initial.consultant.consultationTypes[0];
    return null;
  });
  const [startAt, setStartAt] = useState<string | null>(params.get('slot'));
  const [date, setDate] = useState<string | null>(() => (params.get('slot') ? istDate(new Date(params.get('slot')!)) : null));
  const [phase, setPhase] = useState<Phase>('pick');
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [checkout, setCheckout] = useState<BookingCheckout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const { consultant } = data;
  const days = useMemo(() => {
    const byDate = new Map<string, PublicConsultantSlots['slots']>();
    for (const s of data.slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
    return byDate;
  }, [data.slots]);
  const activeDate = date && days.has(date) ? date : (days.keys().next().value ?? null);
  const slotsOfDay = activeDate ? (days.get(activeDate) ?? []) : [];
  const picked = data.slots.find((s) => s.startAt === startAt) ?? null;

  const fetchSlots = useCallback(() => {
    const from = istDate(new Date());
    return api.call((c) => c.GET('/api/public/consultants/{slug}/slots', { params: { path: { slug }, query: { from, to: addDays(from, 13) } } }));
  }, [api, slug]);
  const reload = useCallback(async () => setData(await fetchSlots()), [fetchSlots]);

  // Fresh slots in the browser (the server's copy may be a minute old).
  useEffect(() => {
    let live = true;
    fetchSlots()
      .then((fresh) => live && setData(fresh))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fetchSlots]);

  // The hold countdown.
  useEffect(() => {
    if (phase !== 'held') return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [phase]);

  // Waiting for the webhook.
  useEffect(() => {
    if (phase !== 'confirming' || !booking) return;
    let live = true;
    const until = Date.now() + GIVE_UP_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const b = await api.call((c) => c.GET('/api/bookings/{id}', { params: { path: { id: booking!.id } } }));
        if (!live) return;
        setBooking(b);
        if (b.status === 'CONFIRMED') return setPhase('confirmed');
        if (b.status === 'EXPIRED') {
          setError('Your payment arrived after the slot was given to someone else. The amount will be refunded; please pick another slot.');
          return setPhase('pick');
        }
      } catch {
        // Keep waiting; a blip shouldn't end it.
      }
      if (Date.now() < until) timer = setTimeout(tick, POLL_MS);
      else setError('We haven’t heard from the payment service yet. If money was taken, your booking will be confirmed shortly — check My consultations.');
    }
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [phase, booking, api]);

  function choose(next: { type?: ConsultationType; date?: string; startAt?: string | null }) {
    const t = next.type ?? type;
    const s = next.startAt === undefined ? startAt : next.startAt;
    if (next.type !== undefined) setType(next.type);
    if (next.date !== undefined) setDate(next.date);
    if (next.startAt !== undefined) setStartAt(next.startAt);
    setError('');
    // Kept in the URL so signing in brings the customer back to the same choice.
    const q = new URLSearchParams();
    if (t) q.set('type', t);
    if (s) q.set('slot', s);
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  async function hold() {
    if (!type || !picked) return;
    if (!user) {
      const next = `${pathname}?${new URLSearchParams({ type, slot: picked.startAt })}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const b = await api.call((c) => c.POST('/api/bookings', { body: { consultantSlug: slug, type, startAt: picked.startAt } }));
      setBooking(b);
      setCheckout(null);
      setPhase('held');
    } catch (e) {
      setError(message(e));
      if (e instanceof ClientApiError && e.status === 409) {
        setStartAt(null);
        await reload().catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  const confirm = useCallback(
    async (c: BookingCheckout, r: RazorpaySuccess) => {
      setPhase('confirming');
      try {
        await api.call((cl) =>
          cl.POST('/api/bookings/{id}/payment/callback', {
            params: { path: { id: c.bookingId } },
            body: { paymentId: c.paymentId, gatewayOrderId: r.razorpay_order_id, gatewayPaymentId: r.razorpay_payment_id, signature: r.razorpay_signature },
          }),
        );
      } catch {
        // Only a hint: the webhook confirms the booking whether or not this reached us.
      }
    },
    [api],
  );

  async function pay() {
    if (!booking) return;
    setBusy(true);
    setError('');
    try {
      const c = await api.call((cl) => cl.POST('/api/bookings/{id}/payment', { params: { path: { id: booking.id } } }));
      setCheckout(c);
      if (c.gateway === 'MOCK') return;
      await openRazorpayCheckout(c, {
        onSuccess: (r) => void confirm(c, r),
        onDismiss: () => undefined,
        onFailure: (m) => setError(`${m} You can try again or choose another method.`),
      });
    } catch (e) {
      setError(message(e));
      if (e instanceof ClientApiError && e.status === 409) setPhase('pick');
    } finally {
      setBusy(false);
    }
  }

  async function payMock() {
    if (!checkout) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.call((cl) => cl.POST('/api/payments/mock/{paymentId}/pay', { params: { path: { paymentId: checkout.paymentId } } }));
      await confirm(checkout, { razorpay_order_id: r.gatewayOrderId, razorpay_payment_id: r.gatewayPaymentId, razorpay_signature: r.signature });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const left = booking?.holdExpiresAt ? Math.max(0, new Date(booking.holdExpiresAt).getTime() - now) : 0;
  const expired = phase === 'held' && left === 0;
  const mmss = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8 sm:px-6 sm:py-10">
      <Breadcrumbs items={[{ href: '/consultants', label: 'Consultants' }, { label: consultant.name }]} />
      <header className="mt-4">
        <h1 className="text-2xl font-bold tracking-[-0.025em] sm:text-3xl">Book {consultant.name}</h1>
        <p className="mt-1 text-muted">
          {consultant.qualification} · <span className="num">{money(consultant.feePerSession)}</span> for {consultant.sessionMinutes} minutes · times in IST
        </p>
      </header>

      {error && (
        <div className="mt-5" role="alert">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {phase === 'confirmed' && booking && (
        <section className="mt-6 rounded-xl border-2 border-night bg-white p-5 shadow-[6px_6px_0_0_#121a45] sm:p-6" aria-live="polite">
          <div className="flex items-center gap-2 text-ink">
            <Icon name="badge" size={22} />
            <h2 className="text-xl font-bold">Booking confirmed</h2>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
            <dt className="text-muted">Booking</dt>
            <dd className="num font-semibold">{booking.code}</dd>
            <dt className="text-muted">When</dt>
            <dd>
              {dayLabel(istDate(new Date(booking.startAt)))}, {timeLabel(booking.startAt)} – {timeLabel(booking.endAt)} IST
            </dd>
            <dt className="text-muted">Type</dt>
            <dd>{TYPE_LABEL[booking.type]}</dd>
            <dt className="text-muted">Paid</dt>
            <dd className="num">{money(booking.fee)}</dd>
          </dl>
          {booking.meetingLink && <p className="mt-4"><a href={booking.meetingLink} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-2">Join your consultation</a></p>}
          <p className="mt-4 text-sm text-muted">We’ll send the meeting details to your email and phone before the session.</p>
          <LinkButton href="/dashboard" variant="outline" className="mt-5">
            Go to dashboard
          </LinkButton>
        </section>
      )}

      {phase === 'confirming' && (
        <div className="mt-6" role="status">
          <Notice tone="info">Payment received — confirming your booking…</Notice>
        </div>
      )}

      {phase === 'held' && booking && (
        <section className="mt-6 rounded-xl bg-white p-5 ring-1 ring-rule sm:p-6">
          <h2 className="text-lg font-semibold">Pay to confirm</h2>
          <p className="mt-1 text-[15px]">
            {TYPE_LABEL[booking.type]} · {dayLabel(istDate(new Date(booking.startAt)))}, {timeLabel(booking.startAt)} IST
          </p>
          <p className="mt-3 text-sm" aria-live="polite">
            {expired ? (
              <span className="text-red-700">Your hold ran out. Pick the slot again.</span>
            ) : (
              <>
                Slot held for you for <span className="num font-semibold">{mmss}</span>
              </>
            )}
          </p>
          {checkout?.gateway === 'MOCK' && (
            <div className="mt-4">
              <Notice tone="info">
                Test mode: the mock payment gateway is in use, so no payment window opens. Booking <span className="num">{checkout.bookingCode}</span> is waiting for{' '}
                <span className="num">{money(checkout.amount)}</span>.
              </Notice>
            </div>
          )}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            {checkout?.gateway === 'MOCK' ? (
              <Button type="button" onClick={payMock} disabled={busy || expired} className="w-full sm:w-auto">
                Complete test payment
              </Button>
            ) : (
              <Button type="button" onClick={pay} disabled={busy || expired} className="w-full sm:w-auto">
                Pay {money(booking.fee)}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setPhase('pick');
                setError('');
                void reload().catch(() => undefined);
              }}
            >
              Change slot
            </Button>
          </div>
        </section>
      )}

      {phase === 'pick' && (
        <div className="mt-6 space-y-7">
          <fieldset className="min-w-0">
            <legend className="font-semibold">1. Consultation type</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {consultant.consultationTypes.map((t) => (
                <Button key={t} type="button" size="sm" variant={type === t ? 'ink' : 'outline'} aria-pressed={type === t} onClick={() => choose({ type: t })}>
                  {TYPE_LABEL[t]}
                </Button>
              ))}
            </div>
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="font-semibold">2. Date</legend>
            {days.size === 0 ? (
              <p className="mt-3 text-muted">No free slots in the next two weeks. Request a call back from the consultants page instead.</p>
            ) : (
              <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                {[...days.keys()].map((d) => (
                  <Button key={d} type="button" size="sm" variant={activeDate === d ? 'ink' : 'outline'} aria-pressed={activeDate === d} className="shrink-0" onClick={() => choose({ date: d, startAt: null })}>
                    {dayLabel(d)}
                  </Button>
                ))}
              </div>
            )}
          </fieldset>

          {slotsOfDay.length > 0 && (
            <fieldset className="min-w-0">
              <legend className="font-semibold">3. Time</legend>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {slotsOfDay.map((s) => (
                  <Button key={s.startAt} type="button" size="sm" variant={startAt === s.startAt ? 'ink' : 'outline'} aria-pressed={startAt === s.startAt} className="num" onClick={() => choose({ startAt: s.startAt })}>
                    {timeLabel(s.startAt)}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="rounded-xl bg-white p-4 ring-1 ring-rule sm:p-5">
            <p className="text-[15px]">
              {type && picked ? (
                <>
                  {TYPE_LABEL[type]} · {dayLabel(picked.date)}, {timeLabel(picked.startAt)} IST · <span className="num font-semibold">{money(consultant.feePerSession)}</span>
                </>
              ) : (
                <span className="text-muted">Choose a type, a date and a time.</span>
              )}
            </p>
            <Button type="button" onClick={hold} disabled={!type || !picked || busy || !ready} className="mt-4 w-full sm:w-auto">
              {user ? `Hold slot & pay ${money(consultant.feePerSession)}` : 'Sign in to book'}
            </Button>
            <p className="mt-2 text-xs text-muted">The slot is held for 10 minutes while you pay.</p>
          </div>
        </div>
      )}
    </div>
  );
}
