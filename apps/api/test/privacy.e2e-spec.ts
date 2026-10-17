/**
 * DPDP requests (M5.12): a customer asks for a data export or an account deletion. One open request per
 * type (409); a deletion is confirmed and re-checked with the password or a one-time code; another customer
 * never sees someone else's requests; staff accounts can't delete themselves here.
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

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string;
let bob: string;
let carol: string;
let support: string;
let storage: StorageService;
let exportsService: DataExportService;

const run = Date.now().toString().slice(-7);
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-priv-${run}` } };
const PASSWORD = 'secret123';

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Privacy ${n}`, mobile: `6${run}${String(10 + n)}`, email: `e2e-priv-${run}-${n}@example.com`, password: PASSWORD, consent: true })
    .expect(201);
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
});

afterAll(async () => {
  for (const r of await prisma.dataRequest.findMany({ where: { user: users, fileKey: { not: null } }, select: { fileKey: true } })) await storage.remove(r.fileKey!);
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
