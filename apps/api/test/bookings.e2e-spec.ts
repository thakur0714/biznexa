/**
 * Booking hold + payment (M8.8): a booking holds its slot for 10 minutes; parallel requests for one slot give
 * exactly one hold (consultant row lock + exclusion constraint); an expired hold frees the slot; the webhook
 * confirms a paid booking once; money paid after the slot went to someone else is kept for a refund.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { addDays, istDate, istInstant, type AnyDomainEvent } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { PaymentGateway, type GatewayPayment } from '../src/payments/payment-gateway';
import { MockPaymentGateway } from '../src/payments/mock-payment-gateway';
import { BookingsService } from '../src/bookings/bookings.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let gateway: MockPaymentGateway;
let events: AnyDomainEvent[] = [];

const run = randomUUID().slice(0, 8);
const emailPrefix = `e2e-book-${run}`;
const users = { email: { startsWith: emailPrefix } };
const slug = `${emailPrefix}-consultant`;
const FEE = 80_000;
const day = addDays(istDate(new Date()), 2);
/** IST start of a slot on `day` ("10:30" → instant ISO). */
const at = (time: string) => istInstant(day, Number(time.slice(0, 2)) * 60 + Number(time.slice(3))).toISOString();
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const eventIds: string[] = [];

let consultantId: string;
let consultantUser: { token: string; id: string };
const customers: { token: string; id: string }[] = [];

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Booker ${n}`, mobile: `8${run.replaceAll(/\D/g, '1').padEnd(7, '1').slice(0, 7)}${String(n).padStart(2, '0')}`, email: `${emailPrefix}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

const book = (who: { token: string }, time: string, type = 'VIDEO') => http.post('/api/bookings').set(as(who.token)).send({ consultantSlug: slug, type, startAt: at(time) });
const slotTimes = async () => ((await http.get(`/api/public/consultants/${slug}/slots?from=${day}&to=${day}`).expect(200)).body.slots as { time: string }[]).map((s) => s.time);
function send(w: { body: string; headers: Record<string, string> }) {
  eventIds.push(w.headers['x-razorpay-event-id']);
  return http.post('/api/payments/webhook').set(w.headers).send(w.body).expect(200);
}
const captured = (payment: GatewayPayment, eventId?: string) => gateway.webhook('payment.captured', payment, eventId);
const bookingRow = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, holdExpiresAt: true, payments: { select: { status: true } } } });
const outcomes = async (bookingId: string) =>
  (await prisma.paymentWebhookEvent.findMany({ where: { payment: { bookingId } }, orderBy: { receivedAt: 'asc' }, select: { outcome: true } })).map((e) => e.outcome);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  gateway = app.get(PaymentGateway) as MockPaymentGateway;
  app.get(EventBus).onAny((e) => { events.push(e); });

  consultantUser = await register(0);
  const consultant = await prisma.consultant.create({
    data: {
      userId: consultantUser.id, slug, category: 'CA', qualification: 'CA', experienceYears: 9, expertise: ['GST'], languages: ['English'],
      city: 'Pune', state: 'Maharashtra', feePerSession: FEE, consultationTypes: ['VIDEO', 'AUDIO'], verificationStatus: 'APPROVED',
      sessionMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 0,
      availability: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '14:00' })) },
    },
    select: { id: true },
  });
  consultantId = consultant.id;
  for (let n = 1; n <= 7; n++) customers.push(await register(n)); // NOSONAR: tests run steps in order
});

beforeEach(() => {
  events = [];
});

afterAll(async () => {
  const bookings = { OR: [{ consultantId }, { customer: users }] };
  await prisma.paymentWebhookEvent.deleteMany({ where: { OR: [{ payment: { booking: bookings } }, { eventId: { in: eventIds } }] } });
  await prisma.payment.deleteMany({ where: { booking: bookings } });
  const ids = (await prisma.booking.findMany({ where: bookings, select: { id: true } })).map((b) => b.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actor: users }, { entityType: 'Booking', entityId: { in: ids } }] } });
  await prisma.booking.deleteMany({ where: bookings });
  await prisma.consultant.deleteMany({ where: { id: consultantId } });
  await prisma.refreshToken.deleteMany({ where: { user: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('booking hold (M8.8)', () => {
  it('holds a slot for 10 minutes as PENDING_PAYMENT, visible only to its customer', async () => {
    const [alice, bob] = customers;
    const before = Date.now();
    const res = await book(alice, '09:00').expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING_PAYMENT', type: 'VIDEO', fee: FEE, startAt: at('09:00'), endAt: at('09:30'), consultant: { slug }, payment: null });
    expect(res.body.code).toMatch(/^BKG-\d{4}-\d{6}$/);
    const hold = new Date(res.body.holdExpiresAt).getTime() - before;
    expect(hold).toBeGreaterThan(9.9 * 60_000);
    expect(hold).toBeLessThan(10.1 * 60_000);
    expect(await slotTimes()).not.toContain('09:00');

    // Clicking again returns the same hold.
    expect((await book(alice, '09:00').expect(201)).body.id).toBe(res.body.id);
    await book(bob, '09:00').expect(409);

    await http.get(`/api/bookings/${res.body.id}`).set(as(alice.token)).expect(200);
    await http.get(`/api/bookings/${res.body.id}`).set(as(bob.token)).expect(404);
    await http.post(`/api/bookings/${res.body.id}/payment`).set(as(bob.token)).expect(404);
    expect((await http.get('/api/bookings').set(as(bob.token)).expect(200)).body.items).toEqual([]);
    expect((await http.get('/api/bookings').set(as(alice.token)).expect(200)).body.items.map((b: { id: string }) => b.id)).toEqual([res.body.id]);
  });

  it('confirms with a generated meeting link and serves an owner-only iCalendar file', async () => {
    const alice = customers[0];
    const held = (await book(alice, '09:00').expect(201)).body;
    const pay = (await http.post(`/api/bookings/${held.id}/payment`).set(as(alice.token)).expect(200)).body;
    const paid = gateway.pay(pay.gatewayOrderId);
    await send(captured(paid.payment));
    const confirmed = (await http.get(`/api/bookings/${held.id}`).set(as(alice.token)).expect(200)).body;
    expect(confirmed.meetingLink).toMatch(/^https:\/\/meet\.jit\.si\/BizNexa-/);
    const calendar = await http.get(`/api/bookings/${held.id}/calendar.ics`).set(as(alice.token)).expect(200);
    expect(calendar.headers['content-type']).toContain('text/calendar');
    expect(calendar.text).toContain(`UID:${held.id}@biznexa`);
    expect(calendar.text).toContain(confirmed.meetingLink);
    await http.get(`/api/bookings/${held.id}/calendar.ics`).set(as(customers[1].token)).expect(404);
  });

  it('refuses slots that are not offered, types not offered, booking yourself, and anonymous callers', async () => {
    const [, bob] = customers;
    await book(bob, '09:10').expect(409); // off the slot grid
    await book(bob, '14:00').expect(409); // past the window
    await book(bob, '09:30', 'CHAT').expect(400);
    await book(consultantUser, '09:30').expect(400);
    await http.post('/api/bookings').send({ consultantSlug: slug, type: 'VIDEO', startAt: at('09:30') }).expect(401);
    await http.post('/api/bookings').set(as(bob.token)).send({ consultantSlug: slug, type: 'VIDEO', startAt: at('09:30'), fee: 1 }).expect(400);
    await http.post('/api/bookings').set(as(bob.token)).send({ consultantSlug: 'nobody-here', type: 'VIDEO', startAt: at('09:30') }).expect(404);
    // A customer is not a consultant: the portal's availability routes are forbidden.
    await http.get('/api/consultants/me/availability').set(as(bob.token)).expect(403);
  });

  it('gives exactly one hold when five customers book the same slot at once', async () => {
    const five = customers.slice(2, 7);
    const results = await Promise.all(five.map((c) => book(c, '10:00')));
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409, 409, 409]);
    const live = await prisma.booking.count({ where: { consultantId, startAt: new Date(at('10:00')), status: 'PENDING_PAYMENT' } });
    expect(live).toBe(1);
  });

  it('enforces no overlap in the database itself, not only in the service', async () => {
    const [alice] = customers;
    await expect(
      prisma.booking.create({
        data: { code: `E2E-OVR-${run}`, customerId: alice.id, consultantId, type: 'VIDEO', startAt: new Date(at('10:15')), endAt: new Date(at('10:45')), fee: FEE, status: 'CONFIRMED' },
      }),
    ).rejects.toThrow(/Booking_no_overlap|23P01|exclu/i);
  });

  it('an expired hold frees the slot; its customer can no longer pay', async () => {
    const [, bob, carol] = customers;
    const held = (await book(bob, '10:30').expect(201)).body;
    await prisma.booking.update({ where: { id: held.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect(await slotTimes()).toContain('10:30');
    await http.post(`/api/bookings/${held.id}/payment`).set(as(bob.token)).expect(409);

    const taken = (await book(carol, '10:30').expect(201)).body;
    expect(taken.id).not.toBe(held.id);
    expect((await bookingRow(held.id)).status).toBe('EXPIRED');

    // The sweep tidies holds that ran out.
    await prisma.booking.update({ where: { id: taken.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect(await app.get(BookingsService).expireHolds()).toBeGreaterThanOrEqual(1);
    expect((await bookingRow(taken.id)).status).toBe('EXPIRED');
  });

  it('picking another slot releases your previous hold', async () => {
    const carol = customers[2];
    const first = (await book(carol, '11:00').expect(201)).body;
    await book(carol, '11:30').expect(201);
    expect((await bookingRow(first.id)).status).toBe('EXPIRED');
    expect(await slotTimes()).toContain('11:00');
  });
});

describe('booking payment (M8.8)', () => {
  it('pays through the gateway; the webhook confirms once and emits booking.confirmed', async () => {
    const dave = customers[3];
    const booking = (await book(dave, '12:00').expect(201)).body;
    const pay = (await http.post(`/api/bookings/${booking.id}/payment`).set(as(dave.token)).expect(200)).body;
    expect(pay).toMatchObject({ amount: FEE, currency: 'INR', gateway: 'MOCK', bookingId: booking.id, bookingCode: booking.code });
    // Same rules as an application's payment: a retry reuses the payment and the gateway order.
    const again = (await http.post(`/api/bookings/${booking.id}/payment`).set(as(dave.token)).expect(200)).body;
    expect([again.paymentId, again.gatewayOrderId]).toEqual([pay.paymentId, pay.gatewayOrderId]);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);

    const result = gateway.pay(pay.gatewayOrderId);
    await http.post(`/api/bookings/${booking.id}/payment/callback`).set(as(dave.token)).send({ paymentId: pay.paymentId, gatewayOrderId: pay.gatewayOrderId, gatewayPaymentId: result.paymentId, signature: 'bad' }).expect(400);
    const confirming = (await http.post(`/api/bookings/${booking.id}/payment/callback`).set(as(dave.token)).send({ paymentId: pay.paymentId, gatewayOrderId: pay.gatewayOrderId, gatewayPaymentId: result.paymentId, signature: result.signature }).expect(200)).body;
    expect(confirming).toMatchObject({ status: 'PENDING_PAYMENT', payment: { status: 'PENDING' } });

    const hook = captured(result.payment);
    await send(hook);
    const confirmed = (await http.get(`/api/bookings/${booking.id}`).set(as(dave.token)).expect(200)).body;
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', holdExpiresAt: null, payment: { id: pay.paymentId, status: 'SUCCESS', amount: FEE } });
    expect(events.filter((e) => e.name === 'booking.confirmed')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ bookingId: booking.id, code: booking.code, customerId: dave.id, consultantId, paymentId: pay.paymentId, amount: FEE }) }),
    ]);

    // The same event again, and a new event about the same payment, change nothing.
    events = [];
    await send(hook);
    await send(captured(result.payment));
    expect(events.filter((e) => e.name === 'booking.confirmed')).toEqual([]);
    expect(await outcomes(booking.id)).toEqual(['applied', 'duplicate']);
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Booking', entityId: booking.id, action: 'booking.payment_received' } });
    expect(audit).toHaveLength(1);

    await http.post(`/api/bookings/${booking.id}/payment`).set(as(dave.token)).expect(409);
    expect(await slotTimes()).not.toContain('12:00');
  });

  it('the mock gateway’s dev checkout pays only the caller’s own payment, through the real webhook', async () => {
    const [alice, bob] = customers;
    const booking = (await book(alice, '13:00').expect(201)).body;
    const pay = (await http.post(`/api/bookings/${booking.id}/payment`).set(as(alice.token)).expect(200)).body;
    await http.post(`/api/payments/mock/${pay.paymentId}/pay`).set(as(bob.token)).expect(404);
    await http.post(`/api/payments/mock/${pay.paymentId}/pay`).expect(401);
    const result = (await http.post(`/api/payments/mock/${pay.paymentId}/pay`).set(as(alice.token)).expect(200)).body;
    expect(result.gatewayOrderId).toBe(pay.gatewayOrderId);
    expect((await bookingRow(booking.id)).status).toBe('CONFIRMED');
    await http.post(`/api/bookings/${booking.id}/payment/callback`).set(as(alice.token)).send({ paymentId: pay.paymentId, ...result }).expect(200);
    // Settled: nothing left to pay.
    await http.post(`/api/payments/mock/${pay.paymentId}/pay`).set(as(alice.token)).expect(404);
  });

  it('a failed payment keeps the hold so the customer can try again', async () => {
    const erin = customers[4];
    const booking = (await book(erin, '12:30').expect(201)).body;
    const pay = (await http.post(`/api/bookings/${booking.id}/payment`).set(as(erin.token)).expect(200)).body;
    await send(gateway.webhook('payment.failed', gateway.fail(pay.gatewayOrderId)));
    expect(await bookingRow(booking.id)).toMatchObject({ status: 'PENDING_PAYMENT', payments: [{ status: 'FAILED' }] });
    const retry = (await http.post(`/api/bookings/${booking.id}/payment`).set(as(erin.token)).expect(200)).body;
    expect(retry.paymentId).not.toBe(pay.paymentId);
  });

  it('paid after the hold ran out: confirmed when the slot is still free, kept for a refund when it was taken', async () => {
    const [, , , , , frank, gita] = customers;
    // Still free: confirmed.
    const free = (await book(frank, '11:00').expect(201)).body;
    const freePay = (await http.post(`/api/bookings/${free.id}/payment`).set(as(frank.token)).expect(200)).body;
    await prisma.booking.update({ where: { id: free.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await send(captured(gateway.pay(freePay.gatewayOrderId).payment));
    expect((await bookingRow(free.id)).status).toBe('CONFIRMED');

    // Taken by someone else meanwhile: not confirmed, the money is kept (SUCCESS) for a refund.
    const late = (await book(gita, '09:30').expect(201)).body;
    const latePay = (await http.post(`/api/bookings/${late.id}/payment`).set(as(gita.token)).expect(200)).body;
    await prisma.booking.update({ where: { id: late.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await book(customers[1], '09:30').expect(201);
    await send(captured(gateway.pay(latePay.gatewayOrderId).payment));
    expect(await bookingRow(late.id)).toMatchObject({ status: 'EXPIRED', payments: [{ status: 'SUCCESS' }] });
    expect(await outcomes(late.id)).toEqual(['slot_taken']);
    expect(events.filter((e) => e.name === 'booking.confirmed').map((e) => (e.payload as { bookingId: string }).bookingId)).toEqual([free.id]);
  });
});

describe('booking confirmation and lifecycle (M8.9, M8.10)', () => {
  // A day of its own, so these bookings never meet the slots used above.
  const day3 = addDays(istDate(new Date()), 3);
  const at3 = (time: string) => istInstant(day3, Number(time.slice(0, 2)) * 60 + Number(time.slice(3))).toISOString();
  const svc = () => app.get(BookingsService);

  async function confirmedBooking(who: { token: string }, time: string) {
    const held = (await http.post('/api/bookings').set(as(who.token)).send({ consultantSlug: slug, type: 'VIDEO', startAt: at3(time) }).expect(201)).body;
    const pay = (await http.post(`/api/bookings/${held.id}/payment`).set(as(who.token)).expect(200)).body;
    await send(captured(gateway.pay(pay.gatewayOrderId).payment));
    return held.id as string;
  }
  async function notified(userId: string, event: string) {
    for (let i = 0; i < 50; i++) {
      const rows = await prisma.notification.findMany({ where: { userId, event, channel: 'IN_APP' }, select: { body: true } }); // NOSONAR: tests run steps in order
      if (rows.length) return rows;
      await new Promise((r) => setTimeout(r, 100)); // NOSONAR: tests run steps in order
    }
    return [];
  }
  const history = (bookingId: string) => prisma.bookingStatusHistory.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true } });

  it('sends the confirmation with the consultant, date and meeting link filled in', async () => {
    const carol = customers[2];
    const id = await confirmedBooking(carol, '09:00');
    const [message] = await notified(carol.id, 'consultation.booked');
    expect(message).toBeDefined();
    expect(message.body).toContain('Booker 0');
    expect(message.body).not.toMatch(/{{/);
    expect(await history(id)).toEqual([{ fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED' }]);
  });

  it('cancels more than 24 hours ahead once, notifies, and frees the slot; others get 404', async () => {
    const dave = customers[3];
    const id = await confirmedBooking(dave, '10:00');
    await http.post(`/api/bookings/${id}/cancel`).set(as(customers[4].token)).send({}).expect(404);
    const res = await http.post(`/api/bookings/${id}/cancel`).set(as(dave.token)).send({ reason: 'Plans changed' }).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    await http.post(`/api/bookings/${id}/cancel`).set(as(dave.token)).send({}).expect(409);
    expect(await history(id)).toEqual([
      { fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED' },
      { fromStatus: 'CONFIRMED', toStatus: 'CANCELLED' },
    ]);
    const [message] = await notified(dave.id, 'consultation.cancelled');
    expect(message.body).toContain('Plans changed');
    // The slot can be booked again.
    await http.post('/api/bookings').set(as(customers[4].token)).send({ consultantSlug: slug, type: 'VIDEO', startAt: at3('10:00') }).expect(201);
  });

  it('refuses to cancel or reschedule within 24 hours of the session', async () => {
    const dave = customers[3];
    const id = await confirmedBooking(dave, '13:30');
    const soon = new Date(new Date(at3('13:30')).getTime() - 23 * 3_600_000);
    await expect(svc().cancel(dave.id, id, undefined, soon)).rejects.toThrow(/24 hours/);
    await expect(svc().reschedule(dave.id, id, new Date(at3('12:30')), soon)).rejects.toThrow(/24 hours/);
  });

  it('reschedules to a free slot, keeps the payment, and refuses a taken or off-grid one', async () => {
    const [, , , , erin, frank] = customers;
    const id = await confirmedBooking(erin, '11:00');
    const other = await confirmedBooking(frank, '12:00');
    await http.post(`/api/bookings/${id}/reschedule`).set(as(erin.token)).send({ startAt: at3('12:00') }).expect(409);
    await http.post(`/api/bookings/${id}/reschedule`).set(as(erin.token)).send({ startAt: at3('11:10') }).expect(409);
    await http.post(`/api/bookings/${id}/reschedule`).set(as(frank.token)).send({ startAt: at3('11:30') }).expect(404);
    const res = await http.post(`/api/bookings/${id}/reschedule`).set(as(erin.token)).send({ startAt: at3('11:30') }).expect(200);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', startAt: at3('11:30'), endAt: at3('12:00'), payment: { status: 'SUCCESS' } });
    expect((await history(id)).slice(1)).toEqual([
      { fromStatus: 'CONFIRMED', toStatus: 'RESCHEDULED' },
      { fromStatus: 'RESCHEDULED', toStatus: 'CONFIRMED' },
    ]);
    // Moving to the next slot is allowed even though it touches the old one; frank's booking is untouched.
    expect((await bookingRow(other)).status).toBe('CONFIRMED');
  });

  it('lets only the consultant set the meeting link and record the outcome, after the session ended', async () => {
    const gita = customers[6];
    const id = await confirmedBooking(gita, '09:30');
    // Consultants need the staff portal (admin.access); a customer token is refused.
    await http.put(`/api/bookings/${id}/meeting-link`).set(as(gita.token)).send({ meetingLink: 'https://meet.example.com/x' }).expect(403);
    await expect(svc().setMeetingLink(gita.id, id, 'https://meet.example.com/x')).rejects.toThrow(/not found/i);
    expect((await svc().setMeetingLink(consultantUser.id, id, 'https://meet.example.com/x')).meetingLink).toBe('https://meet.example.com/x');

    await expect(svc().consultantOutcome(consultantUser.id, id, 'COMPLETED')).rejects.toThrow(/ended/);
    const after = new Date(new Date(at3('10:00')).getTime() + 60_000);
    await expect(svc().consultantOutcome(gita.id, id, 'COMPLETED', after)).rejects.toThrow(/not found/i);
    expect((await svc().consultantOutcome(consultantUser.id, id, 'NO_SHOW', after)).status).toBe('NO_SHOW');
    await expect(svc().consultantOutcome(consultantUser.id, id, 'COMPLETED', after)).rejects.toThrow(/ended/);
    expect((await history(id)).at(-1)).toEqual({ fromStatus: 'CONFIRMED', toStatus: 'NO_SHOW' });
  });
});
