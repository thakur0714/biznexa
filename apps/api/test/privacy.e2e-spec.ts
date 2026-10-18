/**
 * DPDP requests (M5.12): a customer asks for a data export or an account deletion. One open request per
 * type (409); a deletion is confirmed and re-checked with the password or a one-time code; another customer
 * never sees someone else's requests; staff accounts can't delete themselves here. Exports are built by a
 * queue job and downloaded through 5-minute signed links until they expire after 7 days. Staff with
 * `privacy.manage` approve (anonymise) or reject; a deleted user can't sign in, and invoices, payments, credit
 * notes and certificates stay untouched (D61).
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/files/storage.service';
import { signedPath } from '../src/files/files.service';
import { encryptField } from '../src/common/encryption';
import { DataExportService } from '../src/privacy/data-export.service';
import { staffSession } from './staff';
import { readZip } from './zip-reader';
import { Readable } from 'node:stream';
import * as bcrypt from 'bcryptjs';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string;
let bob: string;
let carol: string;
let support: string;
let admin: string;
let storage: StorageService;
let exportsService: DataExportService;

const run = Date.now().toString().slice(-7);
const as = (token: string) => ({ authorization: `Bearer ${token}` });
// By id: a deleted user no longer has the email the test gave them.
const ids: string[] = [];
const users = { id: { in: ids } };
const PASSWORD = 'secret123';

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Privacy ${n}`, mobile: `6${run}${String(10 + n)}`, email: `e2e-priv-${run}-${n}@example.com`, password: PASSWORD, consent: true })
    .expect(201);
  ids.push(res.body.user.id);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  storage = app.get(StorageService);
  exportsService = app.get(DataExportService);
  alice = await register(1);
  bob = await register(2);
  carol = await register(3);
  support = (await staffSession(http, prisma, 'SUPPORT', `e2e-priv-${run}-support@example.com`)).accessToken;
  admin = (await staffSession(http, prisma, 'ADMIN', `e2e-priv-${run}-admin@example.com`)).accessToken;
  for (const role of ['support', 'admin']) ids.push((await prisma.user.findUniqueOrThrow({ where: { email: `e2e-priv-${run}-${role}@example.com` } })).id);
});

afterAll(async () => {
  const mine = { customerId: { in: ids } };
  await prisma.invoice.deleteMany({ where: mine });
  await prisma.payment.deleteMany({ where: { order: mine } });
  await prisma.certificate.deleteMany({ where: { businessEntity: { ownerId: { in: ids } } } });
  await prisma.application.deleteMany({ where: mine });
  await prisma.order.deleteMany({ where: mine });
  await prisma.booking.deleteMany({ where: mine });
  await prisma.consultant.deleteMany({ where: { userId: { in: ids } } });
  await prisma.storedFile.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.service.deleteMany({ where: { slug: `e2e-priv-${run}` } });
  await prisma.certificationBody.deleteMany({ where: { name: `e2e-priv-${run}` } });
  await prisma.auditLog.deleteMany({ where: { entityType: 'DataRequest', entityId: { in: (await prisma.dataRequest.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((d) => d.id) } } });
  for (const r of await prisma.dataRequest.findMany({ where: { user: users, fileKey: { not: null } }, select: { fileKey: true } })) await storage.remove(r.fileKey!);
  await prisma.dataRequest.updateMany({ where: { user: users }, data: { handledById: null } });
  await prisma.dataRequest.deleteMany({ where: { user: users } });
  await prisma.notification.deleteMany({ where: { user: users } });
  await prisma.ticket.deleteMany({ where: { customer: users } });
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('customer requests', () => {
  it('needs a login', async () => {
    await http.get('/api/privacy/requests').expect(401);
    await http.post('/api/privacy/requests').send({ type: 'EXPORT' }).expect(401);
  });

  it('starts empty and says which re-checks the account can use', async () => {
    const res = await http.get('/api/privacy/requests').set(as(alice)).expect(200);
    expect(res.body).toEqual({ items: [], reauth: { password: true, otpChannel: 'MOBILE' } });
  });

  it('allows one open export at a time', async () => {
    const res = await http.post('/api/privacy/requests').set(as(alice)).send({ type: 'EXPORT' }).expect(201);
    expect(res.body).toMatchObject({ type: 'EXPORT', status: expect.stringMatching(/PENDING|PROCESSING|COMPLETED/), downloadable: false });
    const again = await http.post('/api/privacy/requests').set(as(alice)).send({ type: 'EXPORT' });
    // The export job may already have finished it; then a new one is allowed.
    if (again.status !== 201) expect(again.status).toBe(409);
  });

  it('a second open export is refused by the database even if the check is skipped', async () => {
    const aliceId = (await prisma.user.findFirstOrThrow({ where: { email: `e2e-priv-${run}-1@example.com` } })).id;
    await prisma.dataRequest.create({ data: { userId: aliceId, type: 'DELETION', status: 'PENDING' } });
    await expect(prisma.dataRequest.create({ data: { userId: aliceId, type: 'DELETION', status: 'PROCESSING' } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.dataRequest.deleteMany({ where: { userId: aliceId, type: 'DELETION' } });
  });

  it('a deletion must be confirmed and re-checked', async () => {
    await http.post('/api/privacy/requests').set(as(bob)).send({ type: 'DELETION', password: PASSWORD }).expect(400);
    await http.post('/api/privacy/requests').set(as(bob)).send({ type: 'DELETION', confirm: true }).expect(400);
    await http.post('/api/privacy/requests').set(as(bob)).send({ type: 'DELETION', confirm: true, password: PASSWORD, otp: '123456' }).expect(400);
    const wrong = await http.post('/api/privacy/requests').set(as(bob)).send({ type: 'DELETION', confirm: true, password: 'nope1234' }).expect(400);
    expect(wrong.body.message).toBe('Incorrect password');
    expect(await prisma.dataRequest.count({ where: { user: { email: `e2e-priv-${run}-2@example.com` } } })).toBe(0);
  });

  it('a deletion with the password is created once', async () => {
    const res = await http
      .post('/api/privacy/requests')
      .set(as(bob))
      .send({ type: 'DELETION', confirm: true, password: PASSWORD, reason: 'Closing my business' })
      .expect(201);
    expect(res.body).toMatchObject({ type: 'DELETION', status: 'PENDING', reason: 'Closing my business', downloadable: false });
    const again = await http.post('/api/privacy/requests').set(as(bob)).send({ type: 'DELETION', confirm: true, password: PASSWORD }).expect(409);
    expect(again.body.message).toMatch(/already asked to delete/);
  });

  it('a deletion can be re-checked with a one-time code instead', async () => {
    const sent = await http.post('/api/privacy/otp').set(as(carol)).expect(200);
    expect(sent.body).toMatchObject({ channel: 'MOBILE', sentTo: expect.stringMatching(/^6\d\*{6}\d{2}$/) });
    await http.post('/api/privacy/requests').set(as(carol)).send({ type: 'DELETION', confirm: true, otp: '000000' === sent.body.devCode ? '111111' : '000000' }).expect(400);
    await http.post('/api/privacy/requests').set(as(carol)).send({ type: 'DELETION', confirm: true, otp: sent.body.devCode }).expect(201);
  });

  it('a login code does not work as a deletion code', async () => {
    const mobile = `6${run}13`;
    await prisma.dataRequest.deleteMany({ where: { user: { mobile } } });
    // A LOGIN code for the same number (sent 30 s+ apart is not needed: different purpose).
    const login = await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: mobile, purpose: 'LOGIN' }).expect(200);
    await http.post('/api/privacy/requests').set(as(carol)).send({ type: 'DELETION', confirm: true, otp: login.body.devCode }).expect(400);
  });

  it('shows each customer only their own requests', async () => {
    const mine = await http.get('/api/privacy/requests').set(as(bob)).expect(200);
    expect(mine.body.items.map((r: { type: string }) => r.type)).toEqual(['DELETION']);
    const theirs = await http.get('/api/privacy/requests').set(as(alice)).expect(200);
    expect(theirs.body.items.every((r: { type: string }) => r.type === 'EXPORT')).toBe(true);
  });

  it('staff accounts cannot ask for deletion here', async () => {
    const res = await http.post('/api/privacy/requests').set(as(support)).send({ type: 'DELETION', confirm: true, password: 'Staff@12345' }).expect(403);
    expect(res.body.message).toMatch(/Staff and consultant accounts/);
  });
});

/** supertest keeps binary bodies as text unless told otherwise. */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const userId = async (n: number) => (await prisma.user.findFirstOrThrow({ where: { email: `e2e-priv-${run}-${n}@example.com` } })).id;

async function completedExport(token: string, ms = 30_000) {
  const since = Date.now();
  while (Date.now() - since < ms) {
    const res = await http.get('/api/privacy/requests').set(as(token)).expect(200);
    const done = res.body.items.find((r: { type: string; status: string }) => r.type === 'EXPORT' && r.status === 'COMPLETED');
    if (done) return done as { id: string; downloadable: boolean; expiresAt: string };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Export did not complete');
}

describe('data export', () => {
  let exportId: string;
  let zip: Map<string, Buffer>;

  beforeAll(async () => {
    const [aliceId, bobId] = [await userId(1), await userId(2)];
    await prisma.businessEntity.create({ data: { ownerId: aliceId, legalName: `Alice Traders ${run}`, entityType: 'PROPRIETORSHIP', pan: encryptField('ABCDE1234F') } });
    await prisma.businessEntity.create({ data: { ownerId: bobId, legalName: `Bob Secret Works ${run}`, entityType: 'PROPRIETORSHIP' } });
    await http.post('/api/tickets').set(as(alice)).send({ subject: 'Alice ticket', description: 'Help with my GST filing' }).expect(201);
    await http.post('/api/tickets').set(as(bob)).send({ subject: 'Bob private ticket', description: 'Bob only details here' }).expect(201);
    // A fresh export now that alice has data (the one from above may have finished before it existed).
    await prisma.dataRequest.deleteMany({ where: { userId: aliceId } });
    await http.post('/api/privacy/requests').set(as(alice)).send({ type: 'EXPORT' }).expect(201);
    const done = await completedExport(alice);
    exportId = done.id;
    expect(done.downloadable).toBe(true);
    expect(new Date(done.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    const link = (await http.post(`/api/privacy/requests/${exportId}/link`).set(as(alice)).expect(200)).body as { url: string };
    const res = await http.get(link.url).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="biznexa-data-export-\d{4}-\d{2}-\d{2}\.zip"/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    zip = readZip(res.body as Buffer);
  });

  it('holds one JSON file per kind of data, with only this customer in it', () => {
    expect([...zip.keys()].sort()).toEqual(
      ['README.txt', 'applications.json', 'bookings.json', 'business-entities.json', 'credit-notes.json', 'documents.json', 'invoices.json', 'messages.json', 'notifications.json', 'orders.json', 'payments.json', 'profile.json', 'tickets.json'].sort(),
    );
    const json = (name: string) => JSON.parse(zip.get(name)!.toString('utf8'));
    expect(json('profile.json')).toMatchObject({ email: `e2e-priv-${run}-1@example.com`, name: 'Privacy 1' });
    expect(json('profile.json')).not.toHaveProperty('passwordHash');
    expect(json('business-entities.json')).toEqual([expect.objectContaining({ legalName: `Alice Traders ${run}`, pan: 'ABCDE1234F' })]);
    expect(json('tickets.json')).toEqual([expect.objectContaining({ subject: 'Alice ticket' })]);
    const everything = [...zip.values()].map((b) => b.toString('utf8')).join('\n');
    for (const leak of [`e2e-priv-${run}-2@`, 'Bob Secret Works', 'Bob private ticket', 'passwordHash', 'totpSecret']) expect(everything).not.toContain(leak);
  });

  it('tells the customer it is ready', async () => {
    const n = await prisma.notification.findFirst({ where: { userId: await userId(1), event: 'privacy.export_ready', channel: 'IN_APP' } });
    expect(n?.link).toMatch(/\/dashboard\/privacy$/);
  });

  it('another customer cannot get a link for it, or download it with a forged or re-targeted link', async () => {
    await http.post(`/api/privacy/requests/${exportId}/link`).set(as(bob)).expect(404);
    await http.post(`/api/privacy/requests/${exportId}/link`).expect(401);
    const link = (await http.post(`/api/privacy/requests/${exportId}/link`).set(as(alice)).expect(200)).body as { url: string };
    await http.get(link.url.replace(/s=[^&]+/, 's=forged')).expect(403);
    const bobsRequest = await prisma.dataRequest.create({ data: { userId: await userId(2), type: 'EXPORT', status: 'REJECTED' } });
    await http.get(link.url.replace(exportId, bobsRequest.id)).expect(403);
    // A link signed for files or invoices never opens an export.
    const e = Math.floor(Date.now() / 1000) + 60;
    await http.get(signedPath(exportId, e, 'attachment', 'invoices').replace('/api/invoices/', '/api/data-exports/')).expect(403);
  });

  it('a deletion request has no download', async () => {
    const del = (await http.get('/api/privacy/requests').set(as(bob)).expect(200)).body.items.find((r: { type: string }) => r.type === 'DELETION');
    await http.post(`/api/privacy/requests/${del.id}/link`).set(as(bob)).expect(404);
  });

  it('a pending export is not downloadable yet', async () => {
    const pending = await prisma.dataRequest.create({ data: { userId: await userId(3), type: 'EXPORT', status: 'PENDING' } });
    await http.post(`/api/privacy/requests/${pending.id}/link`).set(as(carol)).expect(409);
    expect(await exportsService.run(pending.id)).toBe('completed');
    expect(await exportsService.run(pending.id)).toBe('skipped');
  });

  it('expires after 7 days: links are refused and the cleanup job deletes the file', async () => {
    const link = (await http.post(`/api/privacy/requests/${exportId}/link`).set(as(alice)).expect(200)).body as { url: string };
    const { fileKey } = await prisma.dataRequest.findUniqueOrThrow({ where: { id: exportId } });
    await prisma.dataRequest.update({ where: { id: exportId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http.get(link.url).expect(410);
    await http.post(`/api/privacy/requests/${exportId}/link`).set(as(alice)).expect(410);
    expect(await exportsService.cleanup()).toBeGreaterThanOrEqual(1);
    expect((await prisma.dataRequest.findUniqueOrThrow({ where: { id: exportId } })).fileKey).toBeNull();
    await expect(storage.read(fileKey!)).rejects.toThrow('File not found');
    const list = (await http.get('/api/privacy/requests').set(as(alice)).expect(200)).body.items;
    expect(list.find((r: { id: string }) => r.id === exportId)).toMatchObject({ status: 'COMPLETED', downloadable: false });
    // A new export can be asked for.
    await http.post('/api/privacy/requests').set(as(alice)).send({ type: 'EXPORT' }).expect(201);
  });
});

describe('staff queue and deletion', () => {
  let dave: string;
  let bobId: string;
  let carolId: string;
  let daveId: string;
  let bobDeletion: string;
  let packageId: string;
  let serviceId: string;
  let consultantId: string;
  let kept: { invoice: unknown; payment: unknown; certificate: unknown };
  let uploadKey: string;
  let uploadId: string;
  let bobRefresh: string;
  const seq = { n: 0 };
  const code = (p: string) => `${p}${run}${++seq.n}`;

  const listAs = (token: string, query: Record<string, string> = {}) => http.get('/api/admin/privacy/requests').query(query).set(as(token));
  const deletionOf = async (uid: string) => (await prisma.dataRequest.findFirstOrThrow({ where: { userId: uid, type: 'DELETION', status: 'PENDING' } })).id;

  beforeAll(async () => {
    [bobId, carolId] = [await userId(2), await userId(3)];
    dave = await register(4);
    daveId = await userId(4);
    bobDeletion = await deletionOf(bobId);
    await prisma.dataRequest.create({ data: { userId: carolId, type: 'DELETION', reason: 'Carol wants out' } });

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
    const service = await prisma.service.create({
      data: { slug: `e2e-priv-${run}`, categoryId: cat.id, name: 'Privacy test service', shortDescription: 'Used by the privacy tests.', packages: { create: [{ name: 'Basic', professionalFee: 100000, governmentFee: 0, gstRate: 18 }] } },
      select: { id: true, packages: { select: { id: true } } },
    });
    serviceId = service.id;
    packageId = service.packages[0].id;
    const consultantUser = await register(9);
    consultantId = (await prisma.consultant.create({
      data: { userId: await userId(9), slug: `e2e-priv-${run}`, category: 'CA', qualification: 'CA', experienceYears: 5, city: 'Pune', state: 'Maharashtra', feePerSession: 50000, consultationTypes: ['VIDEO'] },
    })).id;
    void consultantUser;

    // Bob's legal records, which must survive his deletion unchanged.
    const order = await prisma.order.create({ data: { code: code('ORD-P'), customerId: bobId, subtotal: 100000, total: 118000, amountPaid: 118000, status: 'PAID' } });
    await prisma.application.create({ data: { code: code('BNP'), customerId: bobId, serviceId, packageId, orderId: order.id, status: 'DELIVERED', formData: { director: 'Bob Personal Name' } } });
    const payment = await prisma.payment.create({ data: { orderId: order.id, amount: 118000, status: 'SUCCESS', paidAt: new Date(), rawWebhook: { email: 'kept@example.com' } } });
    const invoice = await prisma.invoice.create({
      data: {
        number: code('PRV/'), financialYear: '2026-27', sequence: Math.floor(Math.random() * 100000) + 1000, issuedAt: new Date(), orderId: order.id, paymentId: payment.id, customerId: bobId,
        seller: { name: 'BizNexa' }, buyerName: 'Privacy 2', buyer: { name: 'Privacy 2', email: `e2e-priv-${run}-2@example.com` }, taxType: 'CGST_SGST', lines: [], taxableValue: 100000, cgst: 9000, sgst: 9000, total: 118000, amountInWords: 'One lakh eighteen thousand rupees',
        // Already has a PDF (like the certificate below), so another suite's PDF queue does not render one mid-test and change the row.
        pdfKey: `e2e/privacy-${run}/invoice.pdf`,
      },
    });
    const business = await prisma.businessEntity.create({ data: { ownerId: bobId, legalName: `Bob Proprietor ${run}`, entityType: 'PROPRIETORSHIP', gstin: '03ABCDE1234F1Z5' } });
    const body = await prisma.certificationBody.create({ data: { name: `e2e-priv-${run}` } });
    const certificate = await prisma.certificate.create({
      data: { certificateNumber: code('CERT-P'), verificationId: code('VP'), type: 'ISO 9001:2015', organizationName: `Bob Proprietor ${run}`, issueDate: new Date(), validFrom: new Date(), validUntil: new Date(Date.now() + 365 * 86_400_000), certificationBodyId: body.id, businessEntityId: business.id, pdfKey: `e2e/privacy-${run}/certificate.pdf` },
    });
    kept = { invoice, payment, certificate };

    // An uploaded file, whose bytes go with the account.
    uploadKey = `aa/${run.padStart(32, '0')}`;
    await storage.write(uploadKey, Readable.from(Buffer.from('%PDF-1.4 bob')));
    uploadId = (await prisma.storedFile.create({ data: { fileKey: uploadKey, ownerId: bobId, originalName: 'Bob PAN card.pdf', mimeType: 'application/pdf', sizeBytes: 12, sha256: 'x', scanStatus: 'CLEAN' } })).id;
    await prisma.lead.create({ data: { name: 'Bob lead', mobile: `6${run}12`, source: 'contact' } });

    const login = await http.post('/api/auth/login').set('x-client', 'mobile').send({ email: `e2e-priv-${run}-2@example.com`, password: PASSWORD }).expect(200);
    bobRefresh = login.body.refreshToken;
  });

  it('is for privacy.manage only', async () => {
    await http.get('/api/admin/privacy/requests').expect(401);
    await listAs(alice).expect(403);
    await listAs(support).expect(403);
    await http.post(`/api/admin/privacy/requests/${bobDeletion}/approve`).set(as(support)).expect(403);
    await http.post(`/api/admin/privacy/requests/${bobDeletion}/reject`).set(as(support)).send({ reason: 'Not allowed' }).expect(403);
    await http.post(`/api/admin/privacy/requests/${bobDeletion}/approve`).set(as(bob)).expect(403);
  });

  it('lists requests with the customer and why a deletion is blocked', async () => {
    const res = await listAs(admin, { type: 'DELETION', status: 'PENDING', limit: '100' }).expect(200);
    const bobRow = res.body.items.find((r: { id: string }) => r.id === bobDeletion);
    expect(bobRow).toMatchObject({ type: 'DELETION', status: 'PENDING', reason: 'Closing my business', blockers: [], user: { id: bobId, email: `e2e-priv-${run}-2@example.com`, deleted: false }, handledBy: null });
    expect(res.body.items.every((r: { type: string; status: string }) => r.type === 'DELETION' && r.status === 'PENDING')).toBe(true);
  });

  it('refuses a deletion while an application is in progress, a balance is due or a consultation is coming up', async () => {
    const del = (body: object = {}) => http.post('/api/privacy/requests').set(as(dave)).send({ type: 'DELETION', confirm: true, password: PASSWORD, ...body });

    const app1 = await prisma.application.create({ data: { code: code('BNP'), customerId: daveId, serviceId, packageId, status: 'IN_PROGRESS' } });
    expect((await del().expect(409)).body.message).toBe("We can't delete your account yet: 1 application is still in progress. Please try again once that is done.");
    await prisma.application.update({ where: { id: app1.id }, data: { status: 'COMPLETED' } });

    const order = await prisma.order.create({ data: { code: code('ORD-P'), customerId: daveId, subtotal: 100000, total: 118000, amountPaid: 50000, status: 'PARTIALLY_PAID' } });
    expect((await del().expect(409)).body.message).toMatch(/1 order has a balance due/);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', amountPaid: 118000 } });

    const start = new Date(Date.now() + 2 * 86_400_000);
    const booking = await prisma.booking.create({ data: { code: code('BKG-P'), customerId: daveId, consultantId, type: 'VIDEO', startAt: start, endAt: new Date(start.getTime() + 1_800_000), fee: 50000, status: 'CONFIRMED' } });
    expect((await del().expect(409)).body.message).toMatch(/1 consultation is coming up/);

    // A request made before the booking: staff see the blocker and can't approve it either.
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
    await del().expect(201);
    const daveDeletion = await deletionOf(daveId);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
    const row = (await listAs(admin, { type: 'DELETION', status: 'PENDING', limit: '100' }).expect(200)).body.items.find((r: { id: string }) => r.id === daveDeletion);
    expect(row.blockers).toEqual(['1 consultation is coming up']);
    const refused = await http.post(`/api/admin/privacy/requests/${daveDeletion}/approve`).set(as(admin)).expect(409);
    expect(refused.body.message).toBe("This account can't be deleted yet: 1 consultation is coming up.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: daveId } })).status).toBe('ACTIVE');
    // A past booking doesn't block.
    await prisma.booking.update({ where: { id: booking.id }, data: { startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() - 86_000_000) } });
    expect((await listAs(admin, { type: 'DELETION', status: 'PENDING', limit: '100' }).expect(200)).body.items.find((r: { id: string }) => r.id === daveDeletion).blockers).toEqual([]);
  });

  it('rejects with a reason the customer sees; only once', async () => {
    const carolDeletion = await deletionOf(carolId);
    await http.post(`/api/admin/privacy/requests/${carolDeletion}/reject`).set(as(admin)).send({ reason: 'No' }).expect(400);
    const res = await http.post(`/api/admin/privacy/requests/${carolDeletion}/reject`).set(as(admin)).send({ reason: 'Please settle the open ticket first' }).expect(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Please settle the open ticket first', handledBy: { name: 'E2E ADMIN' } });
    await http.post(`/api/admin/privacy/requests/${carolDeletion}/reject`).set(as(admin)).send({ reason: 'Again and again' }).expect(409);
    await http.post(`/api/admin/privacy/requests/${carolDeletion}/approve`).set(as(admin)).expect(409);
    const mine = (await http.get('/api/privacy/requests').set(as(carol)).expect(200)).body.items.find((r: { id: string }) => r.id === carolDeletion);
    expect(mine).toMatchObject({ status: 'REJECTED', rejectionReason: 'Please settle the open ticket first' });
    expect(await prisma.notification.count({ where: { userId: carolId, event: 'privacy.request_rejected' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'privacy.request_reject', entityId: carolDeletion } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: carolId } })).status).toBe('ACTIVE');
  });

  it('an export needs no approval', async () => {
    const exp = await prisma.dataRequest.findFirstOrThrow({ where: { userId: (await userId(1)), type: 'EXPORT' } });
    expect((await http.post(`/api/admin/privacy/requests/${exp.id}/approve`).set(as(admin)).expect(409)).body.message).toMatch(/need no approval/);
  });

  it('approving anonymises the account; the person can no longer sign in', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: bobId } });
    const res = await http.post(`/api/admin/privacy/requests/${bobDeletion}/approve`).set(as(admin)).expect(200);
    expect(res.body).toMatchObject({ status: 'COMPLETED', user: { id: bobId, name: 'Deleted user', email: null, mobile: null, deleted: true } });
    await http.post(`/api/admin/privacy/requests/${bobDeletion}/approve`).set(as(admin)).expect(409);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: bobId }, include: { customerProfile: true } });
    expect(after).toMatchObject({ name: 'Deleted user', email: null, mobile: null, passwordHash: null, googleId: null, status: 'DELETED', consentAt: before.consentAt });
    expect(after.deletedAt).not.toBeNull();
    expect(after.customerProfile).toMatchObject({ panMasked: null, address: null, pincode: null });

    // Every way in is closed.
    await http.post('/api/auth/login').send({ email: `e2e-priv-${run}-2@example.com`, password: PASSWORD }).expect(401);
    await http.post('/api/auth/refresh').set('x-client', 'mobile').send({ refreshToken: bobRefresh }).expect(401);
    expect(await prisma.refreshToken.count({ where: { userId: bobId } })).toBe(0);
    const otp = await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: `6${run}12`, purpose: 'LOGIN' }).expect(200);
    expect(otp.body.devCode).toBeUndefined(); // the number no longer belongs to anyone
    // A password set on the row by mistake still can't open a session.
    await prisma.user.update({ where: { id: bobId }, data: { email: `e2e-priv-${run}-2@example.com`, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    await http.post('/api/auth/login').send({ email: `e2e-priv-${run}-2@example.com`, password: PASSWORD }).expect(403);
    await prisma.user.update({ where: { id: bobId }, data: { email: null, passwordHash: null } });
  });

  it('removes what Bob wrote and uploaded', async () => {
    const business = await prisma.businessEntity.findFirstOrThrow({ where: { ownerId: bobId, gstin: null, legalName: 'Deleted business' } });
    expect(business.deletedAt).not.toBeNull();
    expect(await prisma.businessEntity.count({ where: { ownerId: bobId, legalName: { contains: 'Bob' } } })).toBe(0);
    expect((await prisma.application.findFirstOrThrow({ where: { customerId: bobId } })).formData).toEqual({});
    expect((await prisma.ticket.findFirstOrThrow({ where: { customerId: bobId } })).description).toBe('[deleted]');
    expect(await prisma.lead.count({ where: { mobile: `6${run}12` } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: bobId } })).toBe(0);

    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: uploadId } });
    expect(file).toMatchObject({ originalName: 'deleted' });
    expect(file.deletedAt).not.toBeNull();
    await expect(storage.read(uploadKey)).rejects.toThrow('File not found');
    await http.post(`/api/files/${uploadId}/link`).set(as(admin)).expect(410);
  });

  it('keeps invoices, payments and certificates exactly as they were', async () => {
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: (kept.invoice as { id: string }).id } })).toEqual(kept.invoice);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: (kept.payment as { id: string }).id } });
    expect({ ...payment, updatedAt: null }).toEqual({ ...(kept.payment as object), updatedAt: null });
    expect(await prisma.certificate.findUniqueOrThrow({ where: { id: (kept.certificate as { id: string }).id } })).toEqual(kept.certificate);
    expect(await prisma.order.count({ where: { customerId: bobId } })).toBe(1);
  });

  it('audits the approval without personal data, and the account can no longer be reactivated', async () => {
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'privacy.deletion_approve', entityId: bobDeletion } });
    expect(audit.after).toEqual({ userId: bobId, filesDeleted: 1 });
    expect(JSON.stringify(audit)).not.toContain('@example.com');
    const customersAdmin = await http.patch(`/api/admin/customers/${bobId}/status`).set(as(admin)).send({ status: 'ACTIVE', reason: 'Bring it back' });
    expect(customersAdmin.status).toBe(409);
  });
});
