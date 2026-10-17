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
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string;
let bob: string;
let carol: string;
let support: string;

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
  alice = await register(1);
  bob = await register(2);
  carol = await register(3);
  support = (await staffSession(http, prisma, 'SUPPORT', `e2e-priv-${run}-support@example.com`)).accessToken;
});

afterAll(async () => {
  await prisma.dataRequest.deleteMany({ where: { user: users } });
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
