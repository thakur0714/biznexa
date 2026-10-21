/**
 * Notification queue + delivery log (M6.3): event → one job per channel → delivery rows; the same event twice
 * sends once; temporary failures retry, permanent ones don't; staff retry; delayed jobs; provider callbacks; 403s.
 * Real Redis + Postgres; retries are fast here (20 ms base, 3 tries).
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { QueueService } from '../src/queue/queue.service';
import { EmailProvider, FakeEmailProvider } from '../src/notifications/providers/email.provider';
import { PermanentDeliveryError } from '../src/notifications/delivery/delivery-policy';
import { NOTIFICATIONS_QUEUE, NOTIFICATION_QUEUE_OPTIONS, NotificationQueueService } from '../src/notifications/delivery/notification-queue.service';
import { DELIVERY_CALLBACK_CONFIG } from '../src/notifications/delivery/delivery-callbacks.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let events: EventBus;
let email: FakeEmailProvider;
let adminToken: string;
let opsToken: string;
let customerId: string;
let customerEmail: string;
let customerToken: string;

const run = Date.now().toString(36);
const MSG91_TOKEN = `tok-${run}`;
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function waitFor<T>(check: () => Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check(); // NOSONAR: tests run steps in order
    if (value) return value;
    if (Date.now() > until) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25)); // NOSONAR: tests run steps in order
  }
}

const rowsFor = (sourceKey: string) => prisma.notificationDelivery.findMany({ where: { sourceKey }, orderBy: { channel: 'asc' } });
/** Rows for the source once none is QUEUED any more. */
const settled = (sourceKey: string, count: number) =>
  waitFor(async () => {
    const rows = await rowsFor(sourceKey);
    return rows.length === count && rows.every((r) => r.status !== 'QUEUED') && rows;
  });
const byChannel = <T extends { channel: string }>(rows: T[], channel: string) => rows.find((r) => r.channel === channel)!;
const emailsTo = (to: string) => email.sentEmails.filter((m) => m.to === to).length;

function paymentSucceeded(paymentId = randomUUID()) {
  return events.emit('payment.succeeded', {
    paymentId,
    orderId: randomUUID(),
    customerId,
    applicationIds: [],
    amount: 118_000,
    gateway: 'mock',
    gatewayPaymentId: `pay_${run}`,
  });
}

let channelCount: number;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NOTIFICATION_QUEUE_OPTIONS)
    .useValue({ retryBaseMs: 20, attempts: 3 })
    .overrideProvider(DELIVERY_CALLBACK_CONFIG)
    .useValue({ msg91Token: MSG91_TOKEN, sendgridPublicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') })
    .compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  events = app.get(EventBus);
  email = app.get(EmailProvider) as FakeEmailProvider;

  adminToken = (await staffSession(http, prisma, 'ADMIN', `e2e-nq-admin-${run}@example.com`)).accessToken;
  opsToken = (await staffSession(http, prisma, 'OPERATIONS', `e2e-nq-ops-${run}@example.com`)).accessToken;

  customerEmail = `e2e-nq-${run}@example.com`;
  const reg = await http
    .post('/api/auth/register')
    .send({ name: 'Queue Customer', email: customerEmail, mobile: `6${Date.now().toString().slice(-9)}`, password: 'password123', consent: true })
    .expect(201);
  customerId = reg.body.user.id;
  customerToken = reg.body.accessToken;

  channelCount = await prisma.notificationTemplate.count({ where: { event: 'payment.succeeded', isActive: true } });
  expect(channelCount).toBe(5);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await app.close();
});

it('sends to an address given with the notification (anonymised account), then drops it from the log', async () => {
  const sourceKey = randomUUID();
  const to = `gone-${run}@example.com`;
  await app.get(NotificationQueueService).enqueue({
    userId: customerId,
    channel: 'EMAIL',
    event: 'privacy.account_deleted',
    sourceKey,
    title: 'Account deleted',
    body: 'Your account was deleted',
    payload: { customerName: 'Gone' },
    recipient: { email: to },
  });
  const [row] = await settled(sourceKey, 1);
  expect(row.status).toBe('SENT');
  expect(emailsTo(to)).toBe(1);
  expect(JSON.stringify(row.content)).not.toContain(to);
});

it('queues one job per channel and logs each outcome', async () => {
  const paymentId = randomUUID();
  const before = emailsTo(customerEmail);
  await paymentSucceeded(paymentId);

  // Rows exist as soon as the event is handled; sending happens in the worker.
  const queued = await rowsFor(paymentId);
  expect(queued).toHaveLength(channelCount);
  expect(new Set(queued.map((r) => r.idempotencyKey)).size).toBe(channelCount);

  const rows = await settled(paymentId, channelCount);
  expect(byChannel(rows, 'IN_APP')).toMatchObject({ status: 'DELIVERED', attempts: 1, lastError: null });
  expect(byChannel(rows, 'IN_APP').deliveredAt).toBeInstanceOf(Date);
  expect(byChannel(rows, 'EMAIL')).toMatchObject({ status: 'SENT', attempts: 1, userId: customerId, event: 'payment.succeeded' });
  expect(byChannel(rows, 'EMAIL').providerMessageId).toMatch(/^fake-/);
  expect(byChannel(rows, 'EMAIL').templateId).toEqual(expect.any(String));
  expect(byChannel(rows, 'PUSH')).toMatchObject({ status: 'SKIPPED' }); // no device registered
  expect(byChannel(rows, 'WHATSAPP')).toMatchObject({ status: 'SENT' });
  // Seeded SMS templates have no DLT id yet: a permanent failure, tried once, not retried.
  expect(byChannel(rows, 'SMS')).toMatchObject({ status: 'FAILED', attempts: 1 });
  expect(byChannel(rows, 'SMS').lastError).toContain('DLT');
  expect(emailsTo(customerEmail)).toBe(before + 1);

  const inbox = await prisma.notification.count({ where: { userId: customerId, event: 'payment.succeeded' } });
  expect(inbox).toBeGreaterThanOrEqual(1);
});

it('sends once when the same event is emitted twice', async () => {
  const paymentId = randomUUID();
  const before = emailsTo(customerEmail);
  const inboxBefore = await prisma.notification.count({ where: { userId: customerId } });

  await paymentSucceeded(paymentId);
  await paymentSucceeded(paymentId);
  await settled(paymentId, channelCount);
  await new Promise((r) => setTimeout(r, 200)); // anything extra would have run by now

  expect(await rowsFor(paymentId)).toHaveLength(channelCount);
  expect(emailsTo(customerEmail)).toBe(before + 1);
  expect(await prisma.notification.count({ where: { userId: customerId } })).toBe(inboxBefore + 1);
});

it('retries a temporary provider failure with backoff and then sends', async () => {
  const spy = jest.spyOn(email, 'sendEmail').mockRejectedValueOnce(new Error(`SMTP timeout talking to ${customerEmail}`));
  const paymentId = randomUUID();
  await paymentSucceeded(paymentId);

  const rows = await settled(paymentId, channelCount);
  const mail = byChannel(rows, 'EMAIL');
  expect(mail).toMatchObject({ status: 'SENT', attempts: 2, lastError: null });
  expect(spy).toHaveBeenCalledTimes(2);
});

it('does not retry a permanent provider failure, and keeps the address out of the error', async () => {
  const spy = jest.spyOn(email, 'sendEmail').mockRejectedValue(new PermanentDeliveryError(`SendGrid delivery failed (400): invalid ${customerEmail}`));
  const paymentId = randomUUID();
  await paymentSucceeded(paymentId);

  const rows = await settled(paymentId, channelCount);
  await new Promise((r) => setTimeout(r, 200));
  const mail = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: byChannel(rows, 'EMAIL').id } });
  expect(mail).toMatchObject({ status: 'FAILED', attempts: 1 });
  expect(mail.failedAt).toBeInstanceOf(Date);
  expect(mail.lastError).toBe('SendGrid delivery failed (400): invalid [email]');
  expect(spy).toHaveBeenCalledTimes(1);
});

describe('staff', () => {
  let failedId: string;

  beforeAll(async () => {
    // Every try fails → FAILED after the last of 3 tries.
    const spy = jest.spyOn(email, 'sendEmail').mockRejectedValue(new Error('Provider down'));
    const paymentId = randomUUID();
    await paymentSucceeded(paymentId);
    const rows = await settled(paymentId, channelCount);
    const mail = byChannel(rows, 'EMAIL');
    expect(mail).toMatchObject({ status: 'FAILED', attempts: 3, lastError: 'Provider down' });
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
    failedId = mail.id;
  });

  it('lists deliveries with filters, without content', async () => {
    const res = await http
      .get('/api/admin/notifications/deliveries')
      .query({ status: 'FAILED', channel: 'EMAIL', event: 'payment.succeeded', user: customerEmail })
      .set(as(adminToken))
      .expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.items) expect(item).toMatchObject({ status: 'FAILED', channel: 'EMAIL', event: 'payment.succeeded', userId: customerId, userEmail: customerEmail });
    const item = res.body.items.find((i: { id: string }) => i.id === failedId);
    expect(item).toMatchObject({ attempts: 3, lastError: 'Provider down' });
    expect(item).not.toHaveProperty('content');
    expect(item).not.toHaveProperty('idempotencyKey');

    const byId = await http.get('/api/admin/notifications/deliveries').query({ user: customerId, channel: 'IN_APP' }).set(as(adminToken)).expect(200);
    expect(byId.body.items.every((i: { userId: string; channel: string }) => i.userId === customerId && i.channel === 'IN_APP')).toBe(true);

    const future = await http
      .get('/api/admin/notifications/deliveries')
      .query({ user: customerId, from: new Date(Date.now() + 3_600_000).toISOString() })
      .set(as(adminToken))
      .expect(200);
    expect(future.body.total).toBe(0);

    await http.get('/api/admin/notifications/deliveries').query({ status: 'LOST' }).set(as(adminToken)).expect(400);
  });

  it('retries a FAILED delivery (audited), and refuses anything else', async () => {
    const res = await http.post(`/api/admin/notifications/deliveries/${failedId}/retry`).set(as(adminToken)).expect(200);
    expect(res.body).toMatchObject({ id: failedId, status: expect.stringMatching(/QUEUED|SENT/) });

    const sent = await waitFor(async () => {
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: failedId } });
      return row.status === 'SENT' && row;
    });
    expect(sent).toMatchObject({ attempts: 4, lastError: null, failedAt: null });

    const audit = await prisma.auditLog.findFirst({ where: { action: 'notification.retry', entityId: failedId } });
    expect(audit).toMatchObject({ entityType: 'NotificationDelivery', before: expect.objectContaining({ status: 'FAILED' }), after: { status: 'QUEUED' } });

    await http.post(`/api/admin/notifications/deliveries/${failedId}/retry`).set(as(adminToken)).expect(409);
    await http.post(`/api/admin/notifications/deliveries/${randomUUID()}/retry`).set(as(adminToken)).expect(404);
  });

  it('needs notifications.view', async () => {
    await http.get('/api/admin/notifications/deliveries').expect(401);
    await http.get('/api/admin/notifications/deliveries').set(as(opsToken)).expect(403);
    await http.get('/api/admin/notifications/deliveries').set(as(customerToken)).expect(403);
    await http.post(`/api/admin/notifications/deliveries/${failedId}/retry`).set(as(opsToken)).expect(403);
    await http.post(`/api/admin/notifications/deliveries/${failedId}/retry`).set(as(customerToken)).expect(403);
  });
});

it('holds a delayed notification until sendAt', async () => {
  const queue = app.get(NotificationQueueService);
  const sourceKey = `delayed-${randomUUID()}`;
  const sendAt = new Date(Date.now() + 1500);
  const { id, created } = await queue.enqueue({ userId: customerId, channel: 'IN_APP', event: 'consultation.reminder', sourceKey, title: 'Soon', body: 'Your consultation starts soon', sendAt });
  expect(created).toBe(true);

  const job = await waitFor(() => app.get(QueueService).queue(NOTIFICATIONS_QUEUE).getJob(id));
  expect(await job.getState()).toBe('delayed');
  expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } })).status).toBe('QUEUED');

  const done = await waitFor(async () => {
    const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });
    return row.status === 'DELIVERED' && row;
  });
  expect(done.sentAt!.getTime()).toBeGreaterThanOrEqual(sendAt.getTime() - 50);

  // Enqueuing it again (a re-run of the scheduler) adds nothing.
  expect(await queue.enqueue({ userId: customerId, channel: 'IN_APP', event: 'consultation.reminder', sourceKey, body: 'again', sendAt })).toEqual({ id, created: false });
});

describe('provider callbacks', () => {
  async function sentRow(channel: 'EMAIL' | 'SMS', providerMessageId: string) {
    return prisma.notificationDelivery.create({
      data: {
        idempotencyKey: `cb|${providerMessageId}`,
        userId: customerId,
        event: 'payment.succeeded',
        sourceKey: `cb-${providerMessageId}`,
        channel,
        status: 'SENT',
        attempts: 1,
        providerMessageId,
        sentAt: new Date(),
        content: { body: 'x' },
      },
    });
  }
  const signed = (body: string, ts = String(Math.floor(Date.now() / 1000))) => ({
    'content-type': 'application/json',
    'x-twilio-email-event-webhook-timestamp': ts,
    'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.concat([Buffer.from(ts), Buffer.from(body)]), privateKey).toString('base64'),
  });

  it('SendGrid: delivered → DELIVERED, bounce → FAILED; unsigned or tampered → 401', async () => {
    const ok = await sentRow('EMAIL', `sg-ok-${run}`);
    const bad = await sentRow('EMAIL', `sg-bad-${run}`);
    const body = JSON.stringify([
      { event: 'processed', sg_message_id: `${ok.providerMessageId}.filter0001` },
      { event: 'delivered', sg_message_id: `${ok.providerMessageId}.filter0001`, email: customerEmail },
      { event: 'bounce', sg_message_id: `${bad.providerMessageId}.filter0002`, reason: `550 ${customerEmail} does not exist` },
      { event: 'delivered', sg_message_id: 'unknown.filter' },
    ]);

    await http.post('/api/notifications/callbacks/sendgrid').set({ 'content-type': 'application/json' }).send(body).expect(401);
    const headers = signed(body);
    await http.post('/api/notifications/callbacks/sendgrid').set(headers).send(body.replace('bounce', 'delivered')).expect(401);

    const res = await http.post('/api/notifications/callbacks/sendgrid').set(headers).send(body).expect(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ status: 'DELIVERED' });
    const failed = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: bad.id } });
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed.lastError).toBe('Provider reported: bounce (550 [email] does not exist)');

    // Replayed: nothing moves again (only SENT rows change).
    expect((await http.post('/api/notifications/callbacks/sendgrid').set(headers).send(body).expect(200)).body).toEqual({ updated: 0 });
  });

  it('MSG91: report with the token → DELIVERED / FAILED; wrong token → 401', async () => {
    const ok = await sentRow('SMS', `m91-ok-${run}`);
    const bad = await sentRow('SMS', `m91-bad-${run}`);
    const reports = [
      { requestId: ok.providerMessageId, report: [{ status: '1', desc: 'DELIVERED', number: '919876543210' }] },
      { requestId: bad.providerMessageId, report: [{ status: '9', desc: 'NDNC', number: '919876543211' }] },
    ];

    await http.post('/api/notifications/callbacks/msg91').query({ token: 'wrong' }).send(reports).expect(401);
    await http.post('/api/notifications/callbacks/msg91').send(reports).expect(401);

    // MSG91 posts the list as a form field `data`.
    const res = await http
      .post('/api/notifications/callbacks/msg91')
      .query({ token: MSG91_TOKEN })
      .type('form')
      .send({ data: JSON.stringify(reports) })
      .expect(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ status: 'DELIVERED' });
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: bad.id } })).toMatchObject({ status: 'FAILED', lastError: 'Provider reported: NDNC' });
  });
});
