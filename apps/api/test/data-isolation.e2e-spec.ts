/**
 * Customer data isolation (M5.13): customer A can neither read nor change anything of customer B's — not by
 * guessing ids in the URL, not by quoting B's ids in a body (files, applications, businesses), and not through
 * the lists, counts or the dashboard. Every id route answers 404 for another customer's resource, the same as for
 * an id that does not exist, so ids can't be probed. B's records are checked unchanged at the end.
 *
 * Bob owns one of everything; each case first proves Bob himself can use the route (so a 404 for Alice means
 * "not yours", not "broken fixture"), then that Alice can't.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { formatApplicationCode, formatOrderCode, GENERIC_SERVICE_FORM } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { signedPath } from '../src/files/files.service';
import { createStaff } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

const run = Date.now().toString().slice(-7);
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
const ids: string[] = [];
const users = { id: { in: ids } };

type Customer = { id: string; token: string };
let alice: Customer;
let bob: Customer;
let staffId: string;
let serviceId: string;
let packageId: string;
let requirementId: string;
let consultantUserId: string;

/** Everything of Bob's that Alice will try to reach. */
const b = {} as {
  entity: string;
  draft: string;
  draftOrder: string;
  draftPayment: string;
  app: string;
  appCode: string;
  order: string;
  orderCode: string;
  payment: string;
  invoice: string;
  invoiceNumber: string;
  creditNote: string;
  creditNoteNumber: string;
  certificate: string;
  certificateNumber: string;
  docFile: string;
  attachmentFile: string;
  looseFile: string;
  deliverable: string;
  deliverableFile: string;
  requestId: string;
  message: string;
  ticket: string;
  ticketCode: string;
  booking: string;
  bookingCode: string;
  bookingPayment: string;
  notification: string;
  dataExport: string;
  deviceToken: string;
  reminder: string;
};
/** Alice's own draft and file, for "use Bob's id inside my own request" cases. */
let aliceDraft: string;
let aliceFile: string;

async function register(n: number): Promise<Customer> {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Iso ${n}`, mobile: `7${run}${String(10 + n)}`, email: `e2e-iso-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  ids.push(res.body.user.id);
  return { id: res.body.user.id, token: res.body.accessToken };
}

async function upload(token: string, query = '') {
  const res = await http.post(`/api/files${query}`).set(as(token)).attach('file', PDF, 'proof.pdf').expect(201);
  // The virus scan runs on a queue; these tests are about access, so mark the file clean straight away.
  await prisma.storedFile.update({ where: { id: res.body.id }, data: { scanStatus: 'CLEAN', scannedAt: new Date() } });
  return { id: res.body.id as string, fileKey: (await prisma.storedFile.findUniqueOrThrow({ where: { id: res.body.id } })).fileKey };
}

let seq = (Number(run) % 800_000) + 100_000;
async function seedApplication(customerId: string, status: 'DRAFT' | 'IN_PROGRESS', orderStatus: 'CREATED' | 'PAID', businessEntityId?: string) {
  seq++;
  const order = await prisma.order.create({
    data: { code: formatOrderCode(seq), customerId, subtotal: 100_000, total: 118_000, amountPaid: orderStatus === 'PAID' ? 118_000 : 0, status: orderStatus },
  });
  const created = await prisma.application.create({
    data: { code: formatApplicationCode(seq), orderId: order.id, customerId, serviceId, packageId, formSchemaVersion: 1, status, businessEntityId },
  });
  return { order, app: created };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  alice = await register(1);
  bob = await register(2);
  staffId = await createStaff(prisma, 'OPERATIONS', `e2e-iso-${run}-ops@example.com`);
  ids.push(staffId);

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const svc = await prisma.service.create({
    data: {
      slug: `e2e-iso-${run}`,
      categoryId: cat.id,
      name: `Isolation ${run}`,
      shortDescription: 'Service for the data isolation tests.',
      packages: { create: [{ name: 'Standard', professionalFee: 100_000 }] },
      documents: { create: [{ name: 'PAN Card', isMandatory: true, sortOrder: 1 }] },
      formSchemas: { create: [{ version: 1, schema: JSON.parse(JSON.stringify(GENERIC_SERVICE_FORM)), isCurrent: true }] },
    },
    select: { id: true, packages: { select: { id: true } }, documents: { select: { id: true } } },
  });
  serviceId = svc.id;
  packageId = svc.packages[0].id;
  requirementId = svc.documents[0].id;

  // ---- Bob's things ----
  b.entity = (await http.post('/api/business-entities').set(as(bob.token)).send({ legalName: `Bob Secret Works ${run}`, entityType: 'PROPRIETORSHIP' }).expect(201)).body.id;

  const draft = await seedApplication(bob.id, 'DRAFT', 'CREATED', b.entity);
  b.draft = draft.app.id;
  b.draftOrder = draft.order.id;
  b.draftPayment = (await prisma.payment.create({ data: { orderId: draft.order.id, gateway: 'MOCK', gatewayOrderId: `order_iso_${run}_d`, amount: 118_000 } })).id;

  const live = await seedApplication(bob.id, 'IN_PROGRESS', 'PAID', b.entity);
  b.app = live.app.id;
  b.appCode = live.app.code;
  b.order = live.order.id;
  b.orderCode = live.order.code;
  b.payment = (await prisma.payment.create({ data: { orderId: live.order.id, gateway: 'MOCK', amount: 118_000, status: 'SUCCESS', paidAt: new Date() } })).id;

  const docFile = await upload(bob.token, `?requirementId=${requirementId}`);
  b.docFile = docFile.id;
  await prisma.applicationDocument.create({
    data: { applicationId: b.app, requirementId, name: 'PAN Card', fileKey: docFile.fileKey, fileName: 'proof.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, status: 'UPLOADED', uploadedAt: new Date() },
  });
  b.requestId = `00000000-0000-4000-8000-${run.padStart(12, '0')}`;
  await prisma.applicationDocument.create({ data: { applicationId: b.app, requestId: b.requestId, name: 'Rent agreement', status: 'REQUIRED' } });

  const delivered = await upload(bob.token);
  // A deliverable's file is staff's upload in real life; owned by staff here, so only the deliverable grants Bob access.
  await prisma.storedFile.update({ where: { id: delivered.id }, data: { ownerId: staffId } });
  b.deliverableFile = delivered.id;
  b.deliverable = (await prisma.finalDeliverable.create({ data: { applicationId: b.app, title: 'Registration certificate', fileKey: delivered.fileKey, fileName: 'proof.pdf', uploadedById: staffId } })).id;

  b.attachmentFile = (await upload(bob.token)).id;
  b.message = (await http.post(`/api/applications/${b.app}/messages`).set(as(bob.token)).send({ body: 'Bob private message', fileIds: [b.attachmentFile] }).expect(201)).body.id;
  b.looseFile = (await upload(bob.token)).id;

  const body = await prisma.certificationBody.create({ data: { name: `e2e-iso-${run}` } });
  const cert = await prisma.certificate.create({
    data: {
      certificateNumber: `ISO-${run}-B`,
      verificationId: `VISO${run}B`,
      type: 'ISO 9001:2015',
      organizationName: `Bob Secret Works ${run}`,
      issueDate: new Date('2026-01-01'),
      validFrom: new Date('2026-01-01'),
      validUntil: new Date(Date.now() + 365 * 86_400_000),
      certificationBodyId: body.id,
      applicationId: b.app,
      pdfKey: delivered.fileKey,
    },
  });
  b.certificate = cert.id;
  b.certificateNumber = cert.certificateNumber;

  const party = { name: 'Bob' } as const;
  const invoice = await prisma.invoice.create({
    data: {
      number: `ISO/${run}/1`, financialYear: '2026-27', sequence: Number(run), issuedAt: new Date(), orderId: b.order, paymentId: b.payment, customerId: bob.id,
      seller: party, buyerName: 'Bob', buyer: party, lines: [], taxType: 'IGST', taxableValue: 100_000, igst: 18_000, total: 118_000, amountInWords: 'One lakh eighteen thousand', pdfKey: delivered.fileKey,
    },
  });
  b.invoice = invoice.id;
  b.invoiceNumber = invoice.number;
  const refund = await prisma.refund.create({ data: { paymentId: b.payment, amount: 1_000, reason: 'Goodwill', initiatedById: staffId, status: 'PROCESSED', processedAt: new Date() } });
  const note = await prisma.creditNote.create({
    data: {
      number: `ISO/CN/${run}/1`, financialYear: '2026-27', sequence: Number(run), issuedAt: new Date(), refundId: refund.id, invoiceId: invoice.id, customerId: bob.id,
      seller: party, buyer: party, lines: [], taxType: 'IGST', taxableValue: 847, total: 1_000, amountInWords: 'One thousand', reason: 'Goodwill', pdfKey: delivered.fileKey,
    },
  });
  b.creditNote = note.id;
  b.creditNoteNumber = note.number;

  const ticket = (await http.post('/api/tickets').set(as(bob.token)).send({ subject: 'Bob private ticket', description: 'Only Bob should read this', applicationId: b.app }).expect(201)).body;
  b.ticket = ticket.id;
  b.ticketCode = ticket.code;

  const cUser = await prisma.user.create({ data: { name: `Iso Consultant ${run}`, email: `e2e-iso-${run}-cons@example.com`, consentAt: new Date() } });
  consultantUserId = cUser.id;
  ids.push(cUser.id);
  const consultant = await prisma.consultant.create({
    data: {
      userId: cUser.id, slug: `e2e-iso-${run}`, category: 'CA', qualification: 'CA', experienceYears: 5, city: 'Pune', state: 'Maharashtra',
      feePerSession: 50_000, consultationTypes: ['VIDEO'], verificationStatus: 'APPROVED',
    },
  });
  const startAt = new Date(Date.now() + 3 * 86_400_000);
  const booking = await prisma.booking.create({
    data: {
      code: `BK-ISO-${run}`, customerId: bob.id, consultantId: consultant.id, type: 'VIDEO', startAt, endAt: new Date(startAt.getTime() + 30 * 60_000), fee: 50_000,
      status: 'PENDING_PAYMENT', holdExpiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  b.booking = booking.id;
  b.bookingCode = booking.code;
  b.bookingPayment = (await prisma.payment.create({ data: { bookingId: booking.id, gateway: 'MOCK', gatewayOrderId: `order_iso_${run}_b`, amount: 50_000 } })).id;

  b.notification = (await prisma.notification.create({ data: { userId: bob.id, channel: 'IN_APP', event: 'test.isolation', title: 'Bob only', body: 'Bob private notification' } })).id;
  b.dataExport = (
    await prisma.dataRequest.create({
      data: { userId: bob.id, type: 'EXPORT', status: 'COMPLETED', fileKey: delivered.fileKey, completedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    })
  ).id;
  b.deviceToken = `iso-token-${run}-bob`;
  await http.post('/api/notifications/devices/register').set(as(bob.token)).send({ token: b.deviceToken, platform: 'android' }).expect(200);
  b.reminder = (await prisma.reminder.create({ data: { userId: bob.id, businessEntityId: b.entity, type: 'CERTIFICATE_EXPIRY', title: 'Bob renewal', dueDate: new Date(Date.now() + 30 * 86_400_000) } })).id;

  // ---- Alice's own ----
  aliceDraft = (await seedApplication(alice.id, 'DRAFT', 'CREATED')).app.id;
  aliceFile = (await upload(alice.token)).id;
});

afterAll(async () => {
  const mine = { customerId: { in: ids } };
  await prisma.reminder.deleteMany({ where: { userId: { in: ids } } });
  await prisma.deviceToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.dataRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.creditNote.deleteMany({ where: mine });
  await prisma.refund.deleteMany({ where: { payment: { order: mine } } });
  await prisma.invoice.deleteMany({ where: mine });
  await prisma.certificate.deleteMany({ where: { application: mine } });
  await prisma.certificationBody.deleteMany({ where: { name: `e2e-iso-${run}` } });
  await prisma.messageAttachment.deleteMany({ where: { file: { ownerId: { in: ids } } } });
  await prisma.message.deleteMany({ where: { conversation: { OR: [{ application: mine }, { ticket: mine }, { booking: mine }] } } });
  await prisma.conversation.deleteMany({ where: { OR: [{ application: mine }, { ticket: mine }, { booking: mine }] } });
  await prisma.ticket.deleteMany({ where: mine });
  await prisma.payment.deleteMany({ where: { OR: [{ order: mine }, { booking: mine }] } });
  await prisma.booking.deleteMany({ where: mine });
  await prisma.consultant.deleteMany({ where: { userId: consultantUserId } });
  await prisma.finalDeliverable.deleteMany({ where: { application: mine } });
  await prisma.application.deleteMany({ where: mine });
  await prisma.order.deleteMany({ where: mine });
  await prisma.storedFile.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.service.deleteMany({ where: { slug: `e2e-iso-${run}` } });
  await prisma.businessEntity.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

type Case = { name: string; method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: () => string; body?: () => object; bobStatus?: number };

/**
 * Every customer route that takes the id of something a customer owns. `bobStatus` is what the owner gets
 * (left out for writes that would change Bob's data — those are checked unchanged at the end instead).
 */
const cases: Case[] = [
  // Applications
  { name: 'application detail', method: 'get', path: () => `/api/applications/${b.app}`, bobStatus: 200 },
  { name: 'application timeline', method: 'get', path: () => `/api/applications/${b.app}/timeline`, bobStatus: 200 },
  { name: 'application form save', method: 'patch', path: () => `/api/applications/${b.draft}`, body: () => ({ formData: { hijacked: 'yes' } }) },
  { name: 'order summary', method: 'get', path: () => `/api/applications/${b.draft}/summary`, bobStatus: 200 },
  { name: 'apply coupon', method: 'put', path: () => `/api/applications/${b.draft}/coupon`, body: () => ({ code: 'WELCOME10' }) },
  { name: 'remove coupon', method: 'delete', path: () => `/api/applications/${b.draft}/coupon` },
  // Documents
  { name: 'document checklist', method: 'get', path: () => `/api/applications/${b.app}/documents`, bobStatus: 200 },
  { name: 'attach checklist document', method: 'post', path: () => `/api/applications/${b.app}/documents/${requirementId}`, body: () => ({ fileId: aliceFile }) },
  { name: 'attach requested document', method: 'post', path: () => `/api/applications/${b.app}/documents/additional/${b.requestId}`, body: () => ({ fileId: aliceFile }) },
  { name: 'deliverables', method: 'get', path: () => `/api/applications/${b.app}/deliverables`, bobStatus: 200 },
  // Payments
  { name: 'payment status', method: 'get', path: () => `/api/applications/${b.app}/payment`, bobStatus: 200 },
  { name: 'start payment', method: 'post', path: () => `/api/applications/${b.draft}/payment`, body: () => ({}) },
  {
    name: 'payment callback',
    method: 'post',
    path: () => `/api/applications/${b.draft}/payment/callback`,
    body: () => ({ paymentId: b.draftPayment, gatewayOrderId: `order_iso_${run}_d`, gatewayPaymentId: 'pay_x', signature: 'x' }),
  },
  { name: 'mock gateway pay (order)', method: 'post', path: () => `/api/payments/mock/${b.draftPayment}/pay` },
  { name: 'mock gateway pay (booking)', method: 'post', path: () => `/api/payments/mock/${b.bookingPayment}/pay` },
  // Invoices, credit notes, certificates
  { name: 'invoice link', method: 'post', path: () => `/api/invoices/${b.invoice}/link`, bobStatus: 200 },
  { name: 'credit note link', method: 'post', path: () => `/api/credit-notes/${b.creditNote}/link`, bobStatus: 200 },
  { name: 'certificate detail', method: 'get', path: () => `/api/certificates/${b.certificate}`, bobStatus: 200 },
  { name: 'certificate link', method: 'post', path: () => `/api/certificates/${b.certificate}/link`, bobStatus: 200 },
  // Messages
  { name: 'message thread', method: 'get', path: () => `/api/applications/${b.app}/messages`, bobStatus: 200 },
  { name: 'message unread count', method: 'get', path: () => `/api/applications/${b.app}/messages/unread-count`, bobStatus: 200 },
  { name: 'post message', method: 'post', path: () => `/api/applications/${b.app}/messages`, body: () => ({ body: 'Alice was here' }) },
  { name: 'mark messages read', method: 'post', path: () => `/api/applications/${b.app}/messages/read` },
  // Files (documents, attachments, deliverables)
  { name: 'document file', method: 'get', path: () => `/api/files/${b.docFile}`, bobStatus: 200 },
  { name: 'document file link', method: 'post', path: () => `/api/files/${b.docFile}/link`, bobStatus: 200 },
  { name: 'message attachment', method: 'get', path: () => `/api/files/${b.attachmentFile}`, bobStatus: 200 },
  { name: 'message attachment link', method: 'post', path: () => `/api/files/${b.attachmentFile}/link`, bobStatus: 200 },
  { name: 'deliverable file link', method: 'post', path: () => `/api/files/${b.deliverableFile}/link`, bobStatus: 200 },
  { name: 'unattached upload', method: 'post', path: () => `/api/files/${b.looseFile}/link`, bobStatus: 200 },
  // Tickets
  { name: 'ticket detail', method: 'get', path: () => `/api/tickets/${b.ticket}`, bobStatus: 200 },
  { name: 'ticket reply', method: 'post', path: () => `/api/tickets/${b.ticket}/messages`, body: () => ({ body: 'Alice was here' }) },
  // Bookings
  { name: 'booking detail', method: 'get', path: () => `/api/bookings/${b.booking}`, bobStatus: 200 },
  { name: 'booking payment', method: 'post', path: () => `/api/bookings/${b.booking}/payment` },
  {
    name: 'booking payment callback',
    method: 'post',
    path: () => `/api/bookings/${b.booking}/payment/callback`,
    body: () => ({ paymentId: b.bookingPayment, gatewayOrderId: `order_iso_${run}_b`, gatewayPaymentId: 'pay_x', signature: 'x' }),
  },
  // Businesses
  { name: 'business detail', method: 'get', path: () => `/api/business-entities/${b.entity}`, bobStatus: 200 },
  { name: 'business update', method: 'put', path: () => `/api/business-entities/${b.entity}`, body: () => ({ legalName: 'Hijacked', entityType: 'PROPRIETORSHIP' }) },
  { name: 'business delete', method: 'delete', path: () => `/api/business-entities/${b.entity}` },
  // Notifications, privacy
  { name: 'mark notification read', method: 'post', path: () => `/api/notifications/${b.notification}/read` },
  { name: 'data export link', method: 'post', path: () => `/api/privacy/requests/${b.dataExport}/link`, bobStatus: 200 },
];

describe('another customer’s id in the URL', () => {
  it.each(cases.filter((c) => c.bobStatus))('$name: the owner can use it', async (c) => {
    const req = http[c.method](c.path()).set(as(bob.token));
    await (c.body ? req.send(c.body()) : req).expect(c.bobStatus!);
  });

  it.each(cases)('$name: another customer gets 404, like a missing id', async (c) => {
    const req = http[c.method](c.path()).set(as(alice.token));
    const res = await (c.body ? req.send(c.body()) : req);
    expect(res.status).toBe(404);
    // Nothing of Bob's in the error either.
    for (const leak of [b.appCode, b.orderCode, 'Bob Secret Works', 'Bob private']) expect(JSON.stringify(res.body)).not.toContain(leak);
  });
});

describe('another customer’s ids inside the request body', () => {
  it('cannot start an application for their business', async () => {
    await http.post('/api/applications').set(as(alice.token)).send({ packageId, businessEntityId: b.entity }).expect(404);
  });

  it('cannot open a ticket about their application', async () => {
    await http.post('/api/tickets').set(as(alice.token)).send({ subject: 'Peek', description: 'About Bob’s application', applicationId: b.app }).expect(404);
  });

  it('cannot attach their files to a message', async () => {
    for (const fileId of [b.looseFile, b.attachmentFile, b.docFile, b.deliverableFile]) {
      await http.post(`/api/applications/${aliceDraft}/messages`).set(as(alice.token)).send({ body: 'Look', fileIds: [fileId] }).expect(400);
    }
  });

  it('cannot attach their file as a document', async () => {
    await prisma.application.update({ where: { id: aliceDraft }, data: { status: 'DOCUMENTS_PENDING' } });
    const bobsChecklistFile = await upload(bob.token, `?requirementId=${requirementId}`);
    await http.post(`/api/applications/${aliceDraft}/documents/${requirementId}`).set(as(alice.token)).send({ fileId: bobsChecklistFile.id }).expect(400);
    await prisma.application.update({ where: { id: aliceDraft }, data: { status: 'DRAFT' } });
  });

  it('cannot unregister their push token', async () => {
    const res = await http.delete(`/api/notifications/devices/${b.deviceToken}`).set(as(alice.token));
    expect([403, 404]).toContain(res.status);
    await http.post('/api/notifications/devices/unregister').set(as(alice.token)).send({ token: b.deviceToken }).expect(res.status);
  });
});

describe('signed download links', () => {
  it('a link signed for one resource never opens another (Alice re-targets her own link at Bob’s)', async () => {
    const own = (await http.post(`/api/files/${aliceFile}/link`).set(as(alice.token)).expect(200)).body as { url: string };
    await http.get(own.url.replace(aliceFile, b.looseFile)).expect(403);
    const e = Math.floor(Date.now() / 1000) + 60;
    // Signed for Alice's file id under another scope, aimed at Bob's invoice / certificate / export.
    for (const [scope, target] of [
      ['invoices', b.invoice],
      ['credit-notes', b.creditNote],
      ['certificates', b.certificate],
      ['data-exports', b.dataExport],
    ] as const) {
      await http.get(signedPath(aliceFile, e, 'attachment', 'files').replace(`/api/files/${aliceFile}`, `/api/${scope}/${target}`)).expect(403);
    }
  });
});

describe('lists, counts and the dashboard', () => {
  const routes = [
    '/api/applications',
    '/api/documents',
    '/api/payments',
    '/api/invoices',
    `/api/invoices?applicationId=${'<app>'}`,
    '/api/certificates',
    '/api/tickets',
    '/api/bookings',
    '/api/business-entities',
    '/api/notifications',
    '/api/notifications/unread-count',
    '/api/pending-actions',
    '/api/dashboard/summary',
    '/api/reminders',
    '/api/privacy/requests',
  ];

  it.each(routes)('%s shows Alice nothing of Bob’s', async (route) => {
    const res = await http.get(route.replace('<app>', b.app)).set(as(alice.token)).expect(200);
    const text = JSON.stringify(res.body);
    for (const leak of Object.values(b)) expect(text).not.toContain(leak);
    for (const leak of ['Bob Secret Works', 'Bob private', 'Bob only', 'Bob renewal']) expect(text).not.toContain(leak);
  });

  it('Bob’s own lists do show his things (so the check above means something)', async () => {
    const text = async (route: string) => JSON.stringify((await http.get(route).set(as(bob.token)).expect(200)).body);
    expect(await text('/api/applications')).toContain(b.app);
    expect(await text('/api/invoices')).toContain(b.invoice);
    expect(await text('/api/certificates')).toContain(b.certificate);
    expect(await text('/api/tickets')).toContain(b.ticket);
    expect(await text('/api/bookings')).toContain(b.booking);
    expect(await text('/api/business-entities')).toContain(b.entity);
    expect(await text('/api/notifications')).toContain(b.notification);
    expect(await text('/api/reminders')).toContain(b.reminder);
    expect(await text('/api/privacy/requests')).toContain(b.dataExport);
    expect(await text('/api/documents')).toContain('PAN Card');
  });

  it('the dashboard counts are Alice’s alone', async () => {
    const res = await http.get('/api/dashboard/summary').set(as(alice.token)).expect(200);
    const bobs = await http.get('/api/dashboard/summary').set(as(bob.token)).expect(200);
    expect(res.body).not.toEqual(bobs.body);
  });
});

describe('Bob’s data after all of the above', () => {
  it('is unchanged', async () => {
    const draft = await prisma.application.findUniqueOrThrow({ where: { id: b.draft }, include: { order: true } });
    expect(draft.status).toBe('DRAFT');
    expect(draft.formData).toEqual({});
    expect(draft.order?.couponId ?? null).toBeNull();
    expect(await prisma.payment.count({ where: { orderId: b.draftOrder } })).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: b.draftPayment } })).status).toBe('CREATED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: b.bookingPayment } })).status).toBe('CREATED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.booking } })).status).toBe('PENDING_PAYMENT');

    expect(await prisma.applicationDocument.count({ where: { applicationId: b.app } })).toBe(2);
    expect(await prisma.message.count({ where: { conversation: { applicationId: b.app } } })).toBe(1);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: b.message } })).readAt).toBeNull();
    expect(await prisma.message.count({ where: { conversation: { ticketId: b.ticket } } })).toBe(0);
    expect(await prisma.ticket.count({ where: { customerId: alice.id } })).toBe(0);

    const entity = await prisma.businessEntity.findUniqueOrThrow({ where: { id: b.entity } });
    expect(entity.legalName).toBe(`Bob Secret Works ${run}`);
    expect(entity.deletedAt).toBeNull();
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: b.notification } })).readAt).toBeNull();
    expect((await prisma.deviceToken.findUniqueOrThrow({ where: { token: b.deviceToken } })).userId).toBe(bob.id);
    expect(await prisma.application.count({ where: { customerId: alice.id } })).toBe(1);
  });

  it('while Bob himself can still make those changes (the 404s above were about ownership)', async () => {
    await http.patch(`/api/applications/${b.draft}`).set(as(bob.token)).send({ formData: {} }).expect(200);
    await http.post(`/api/applications/${b.app}/messages`).set(as(bob.token)).send({ body: 'Still mine' }).expect(201);
    await http.post(`/api/applications/${b.app}/messages/read`).set(as(bob.token)).expect(200);
    await http.post(`/api/tickets/${b.ticket}/messages`).set(as(bob.token)).send({ body: 'Still mine' }).expect(201);
    await http.post(`/api/notifications/${b.notification}/read`).set(as(bob.token)).expect(200);
    await http.put(`/api/business-entities/${b.entity}`).set(as(bob.token)).send({ legalName: `Bob Secret Works ${run}`, entityType: 'PROPRIETORSHIP' }).expect(200);
    await http.delete(`/api/notifications/devices/${b.deviceToken}`).set(as(bob.token)).expect(200);
    await http.delete(`/api/business-entities/${b.entity}`).set(as(bob.token)).expect(200);
  });
});
