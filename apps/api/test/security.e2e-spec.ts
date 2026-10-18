/**
 * Security review fixes (M12.1): secure headers, CORS allow-list, the refresh cookie's origin check,
 * single-use password reset tokens and Google sign-in on an account whose email was never verified.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { env } from '../src/config/env';
import { corsOrigins } from '../src/common/security';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

const run = Date.now().toString().slice(-7);
const users = { email: { startsWith: `e2e-sec-${run}` } };
const email = (n: number) => `e2e-sec-${run}-${n}@example.com`;
const mobile = (n: number) => `8${run}${String(n).padStart(2, '0')}`;
const PASSWORD = 'secret123';

async function register(n: number) {
  const res = await http.post('/api/auth/register').send({ name: 'Sec Test', mobile: mobile(n), email: email(n), password: PASSWORD, consent: true }).expect(201);
  return { id: res.body.user.id as string, cookie: res.headers['set-cookie'] as unknown as string[] };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: users });
  await prisma.otpCode.deleteMany({ where: { target: { startsWith: `8${run}` } } });
  await app.close();
});

describe('headers and CORS', () => {
  const allowed = corsOrigins(env().CORS_ORIGINS)[0];

  it('sends helmet’s secure headers and hides the framework', async () => {
    const res = await http.get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    // HSTS only in production (see security.spec.ts): tests run on plain http.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('allows credentialed requests only from the allow-list', async () => {
    const ok = await http.options('/api/auth/login').set('Origin', allowed).set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await http.options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses the refresh cookie from an unknown origin', async () => {
    const evil = await http.post('/api/auth/refresh').set('Origin', 'https://evil.example').set('Cookie', 'bn_rt=whatever');
    expect(evil.status).toBe(403);
    // From the website (or without an Origin header, e.g. the Next.js server) the token itself is checked.
    expect((await http.post('/api/auth/refresh').set('Origin', allowed).set('Cookie', 'bn_rt=whatever')).status).toBe(401);
    expect((await http.post('/api/auth/refresh').set('Cookie', 'bn_rt=whatever')).status).toBe(401);
  });
});

describe('password reset tokens', () => {
  it('work once', async () => {
    await register(1);
    const otp = await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: mobile(1), purpose: 'RESET_PASSWORD' }).expect(200);
    const { resetToken } = (
      await http.post('/api/auth/otp/verify').send({ channel: 'MOBILE', target: mobile(1), purpose: 'RESET_PASSWORD', code: otp.body.devCode }).expect(200)
    ).body;

    await http.post('/api/auth/password/reset').send({ resetToken, password: 'NewSecret123' }).expect(200);
    await http.post('/api/auth/login').send({ email: email(1), password: 'NewSecret123' }).expect(200);

    // Replaying the same token (e.g. from browser history) must not set the password again.
    await http.post('/api/auth/password/reset').send({ resetToken, password: 'Attacker123' }).expect(401);
    await http.post('/api/auth/login').send({ email: email(1), password: 'Attacker123' }).expect(401);
  });
});

describe('Google sign-in on an existing account', () => {
  const auth = () => app.get(AuthService) as unknown as { googleClient?: unknown };
  let clientId: string;

  beforeAll(() => {
    clientId = env().GOOGLE_CLIENT_ID;
    (env() as { GOOGLE_CLIENT_ID: string }).GOOGLE_CLIENT_ID = 'e2e-client-id';
  });
  afterAll(() => {
    (env() as { GOOGLE_CLIENT_ID: string }).GOOGLE_CLIENT_ID = clientId;
    auth().googleClient = undefined;
  });

  const googleSays = (n: number) => {
    auth().googleClient = {
      verifyIdToken: async () => ({ getPayload: () => ({ sub: `google-${run}-${n}`, email: email(n), email_verified: true, name: 'Sec Test' }) }),
    };
    return http.post('/api/auth/google').send({ idToken: 'x'.repeat(40) });
  };

  it('takes over an account whose email was never verified: no password, no old sessions', async () => {
    // Someone registered with this email without owning it, and kept a session.
    const { id } = await register(2);
    await googleSays(2).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user).toMatchObject({ googleId: `google-${run}-2`, emailVerified: true, passwordHash: null });
    const sessions = await prisma.refreshToken.findMany({ where: { userId: id }, orderBy: { createdAt: 'asc' } });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.slice(0, -1).every((s) => s.revokedAt)).toBe(true);
    expect(sessions.at(-1)!.revokedAt).toBeNull(); // the Google session itself
    await http.post('/api/auth/login').send({ email: email(2), password: PASSWORD }).expect(401);
  });

  it('just links a verified account and keeps its password', async () => {
    const { id } = await register(3);
    await prisma.user.update({ where: { id }, data: { emailVerified: true } });
    await googleSays(3).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).googleId).toBe(`google-${run}-3`);
    await http.post('/api/auth/login').send({ email: email(3), password: PASSWORD }).expect(200);
  });
});

describe('OTP login with a mobile the account never verified', () => {
  it('takes the account over like Google does', async () => {
    const { id } = await register(4); // registered, mobile not verified, session kept
    const otp = await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: mobile(4), purpose: 'LOGIN' }).expect(200);
    await http.post('/api/auth/otp/verify').send({ channel: 'MOBILE', target: mobile(4), purpose: 'LOGIN', code: otp.body.devCode }).expect(200);

    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ mobileVerified: true, passwordHash: null });
    const sessions = await prisma.refreshToken.findMany({ where: { userId: id }, orderBy: { createdAt: 'asc' } });
    expect(sessions.slice(0, -1).every((s) => s.revokedAt)).toBe(true);
    await http.post('/api/auth/login').send({ email: email(4), password: PASSWORD }).expect(401);
  });

  it('keeps the password when the mobile was already verified', async () => {
    const { id } = await register(5);
    await prisma.user.update({ where: { id }, data: { mobileVerified: true } });
    const otp = await http.post('/api/auth/otp/request').send({ channel: 'MOBILE', target: mobile(5), purpose: 'LOGIN' }).expect(200);
    await http.post('/api/auth/otp/verify').send({ channel: 'MOBILE', target: mobile(5), purpose: 'LOGIN', code: otp.body.devCode }).expect(200);
    await http.post('/api/auth/login').send({ email: email(5), password: PASSWORD }).expect(200);
  });
});
