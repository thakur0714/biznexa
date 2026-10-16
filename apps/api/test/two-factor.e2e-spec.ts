/**
 * Staff 2FA (M2.5.10, D27) against a real database: staff sessions carry no permissions until an
 * authenticator code is set up or entered; wrong, replayed and brute-forced codes are refused.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TWO_FACTOR_REQUIRED, twoFactorSetupSchema } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { timeStep, totpCode } from '../src/auth/totp';
import { MAX_TOTP_FAILURES } from '../src/auth/two-factor.service';
import { createStaff, STAFF_PASSWORD } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

const run = Date.now().toString().slice(-7);
const email = (n: number) => `e2e-2fa-${run}-${n}@example.com`;
const ADMIN_ROUTE = '/api/admin/catalogue/services';

const bearer = (token: string) => `Bearer ${token}`;
const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
const login = (n: number) => http.post('/api/auth/login').send({ email: email(n), password: STAFF_PASSWORD }).expect(200);
/** A code that is wrong for `secret` in the current ±1 step window. */
function wrongCode(secret: string) {
  const valid = new Set([-1, 0, 1, 2].map((d) => totpCode(secret, timeStep() + d)));
  for (let i = 0; ; i++) {
    const code = String(i).padStart(6, '0');
    if (!valid.has(code)) return code;
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-2fa-${run}` } } });
  await app.close();
});

describe('staff two-factor authentication', () => {
  let secret: string;
  let enabledStep: number;

  it('forces a staff member without 2FA to set it up before any staff route works', async () => {
    await createStaff(prisma, 'ADMIN', email(1));
    const res = await login(1);
    expect(res.body.user.permissions).toContain('services.manage'); // the UI still knows who they are
    expect(res.body.user.twoFactor).toEqual({ required: true, enabled: false, verified: false });

    const denied = await http.get(ADMIN_ROUTE).set('authorization', bearer(res.body.accessToken)).expect(403);
    expect(denied.body.code).toBe(TWO_FACTOR_REQUIRED);
    const me = await http.get('/api/auth/me').set('authorization', bearer(res.body.accessToken)).expect(200);
    expect(me.body.twoFactor).toEqual({ required: true, enabled: false, verified: false });
    // the refreshed session is still unverified
    const refreshed = await http.post('/api/auth/refresh').set('cookie', cookieOf(res)).expect(200);
    expect(refreshed.body.user.twoFactor.verified).toBe(false);
    await http.get(ADMIN_ROUTE).set('authorization', bearer(refreshed.body.accessToken)).expect(403);
    // nothing to verify against yet
    await http.post('/api/auth/2fa/verify').set('authorization', bearer(res.body.accessToken)).send({ code: '123456' }).expect(400);
  });

  it('sets up an authenticator app: QR code + secret, stored encrypted, same secret until confirmed', async () => {
    const { body } = await login(1);
    const auth = bearer(body.accessToken);
    const setup = twoFactorSetupSchema.parse((await http.post('/api/auth/2fa/setup').set('authorization', auth).expect(200)).body);
    secret = setup.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toBe(`otpauth://totp/BizNexa%3A${encodeURIComponent(email(1))}?secret=${secret}&issuer=BizNexa&algorithm=SHA1&digits=6&period=30`);
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await http.post('/api/auth/2fa/setup').set('authorization', auth).expect(200)).body.secret).toBe(secret);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: email(1) } });
    expect(row.totpSecret).toMatch(/^v1\./);
    expect(row.totpSecret).not.toContain(secret);
    expect(row.totpEnabledAt).toBeNull();
  });

  it('refuses a wrong or malformed code during setup and leaves 2FA off', async () => {
    const { body } = await login(1);
    const auth = bearer(body.accessToken);
    const wrong = await http.post('/api/auth/2fa/enable').set('authorization', auth).send({ code: wrongCode(secret) }).expect(400);
    expect(wrong.body.errors).toEqual([{ field: 'code', message: 'That code is not right. Check your authenticator app and try again.' }]);
    const bad = await http.post('/api/auth/2fa/enable').set('authorization', auth).send({ code: '12ab' }).expect(400);
    expect(bad.body.errors[0].field).toBe('code');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: email(1) } })).totpEnabledAt).toBeNull();
  });

  it('turns 2FA on with a correct code and swaps in a verified session', async () => {
    const res = await login(1);
    const oldCookie = cookieOf(res);
    enabledStep = timeStep();
    const enabled = await http
      .post('/api/auth/2fa/enable')
      .set('authorization', bearer(res.body.accessToken))
      .set('cookie', oldCookie)
      .send({ code: totpCode(secret, enabledStep) })
      .expect(200);
    expect(enabled.body.user.twoFactor).toEqual({ required: true, enabled: true, verified: true });
    expect(enabled.body.refreshToken).toBeUndefined();
    await http.get(ADMIN_ROUTE).set('authorization', bearer(enabled.body.accessToken)).expect(200);

    // the password-only session it replaced is gone; the new one stays verified across refreshes
    await http.post('/api/auth/refresh').set('cookie', oldCookie).expect(401);
    const refreshed = await http.post('/api/auth/refresh').set('cookie', cookieOf(enabled)).expect(200);
    expect(refreshed.body.user.twoFactor.verified).toBe(true);
    await http.get(ADMIN_ROUTE).set('authorization', bearer(refreshed.body.accessToken)).expect(200);

    await http.post('/api/auth/2fa/setup').set('authorization', bearer(enabled.body.accessToken)).expect(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email(1) } });
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'user.2fa_enabled' } })).toBe(1);
  });

  it('asks for a code on every new login, and never accepts the same code twice (replay)', async () => {
    const first = await login(1);
    expect(first.body.user.twoFactor).toEqual({ required: true, enabled: true, verified: false });
    await http.get(ADMIN_ROUTE).set('authorization', bearer(first.body.accessToken)).expect(403);

    // the code already used to turn 2FA on, and an older one, are refused even though still in the time window
    // Only steps still inside the ±1 window: on a slow run the clock may have moved on a step since 2FA was
    // enabled, and an older code is then simply "not right" instead of a replay.
    for (const step of [enabledStep, enabledStep - 1].filter((s) => s >= timeStep() - 1)) {
      const replay = await http.post('/api/auth/2fa/verify').set('authorization', bearer(first.body.accessToken)).send({ code: totpCode(secret, step) }).expect(400);
      expect(replay.body.message).toBe('This code has already been used. Wait for the next code in your app.');
    }

    const next = totpCode(secret, enabledStep + 1);
    const ok = await http.post('/api/auth/2fa/verify').set('authorization', bearer(first.body.accessToken)).send({ code: next }).expect(200);
    expect(ok.body.user.twoFactor.verified).toBe(true);
    await http.get(ADMIN_ROUTE).set('authorization', bearer(ok.body.accessToken)).expect(200);

    // someone who saw that code cannot use it for their own login
    const second = await login(1);
    await http.post('/api/auth/2fa/verify').set('authorization', bearer(second.body.accessToken)).send({ code: next }).expect(400);
    await http.get(ADMIN_ROUTE).set('authorization', bearer(second.body.accessToken)).expect(403);
  });

  it(`locks the 2FA check for 15 minutes after ${MAX_TOTP_FAILURES} wrong codes in a row`, async () => {
    await prisma.user.update({ where: { email: email(1) }, data: { totpFailures: 0 } });
    const { body } = await login(1);
    const auth = bearer(body.accessToken);
    for (let i = 0; i < MAX_TOTP_FAILURES; i++) {
      await http.post('/api/auth/2fa/verify').set('authorization', auth).send({ code: wrongCode(secret) }).expect(400);
    }
    // now even the right code is refused until the lock ends
    const locked = await http.post('/api/auth/2fa/verify').set('authorization', auth).send({ code: totpCode(secret, timeStep() + 1) }).expect(429);
    expect(locked.body.message).toMatch(/Too many wrong codes/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email(1) } });
    expect(user.totpLockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'user.2fa_locked' } })).toBe(1);
  });

  it('replaces the refresh token sent in the body for mobile apps', async () => {
    await createStaff(prisma, 'OPERATIONS', email(2));
    const res = await http.post('/api/auth/login').set('x-client', 'mobile').send({ email: email(2), password: STAFF_PASSWORD }).expect(200);
    const auth = bearer(res.body.accessToken);
    const { secret: s2 } = (await http.post('/api/auth/2fa/setup').set('authorization', auth).expect(200)).body;
    const enabled = await http
      .post('/api/auth/2fa/enable')
      .set('authorization', auth)
      .set('x-client', 'mobile')
      .send({ code: totpCode(s2, timeStep()), refreshToken: res.body.refreshToken })
      .expect(200);
    expect(enabled.body.refreshToken).toEqual(expect.any(String));
    await http.post('/api/auth/refresh').set('x-client', 'mobile').send({ refreshToken: res.body.refreshToken }).expect(401);
    const refreshed = await http.post('/api/auth/refresh').set('x-client', 'mobile').send({ refreshToken: enabled.body.refreshToken }).expect(200);
    expect(refreshed.body.user.twoFactor.verified).toBe(true);
  });

  it('does not apply to customers', async () => {
    const reg = await http
      .post('/api/auth/register')
      .send({ name: 'Customer 2FA', mobile: `7${run}03`, email: email(3), password: 'secret123', consent: true })
      .expect(201);
    expect(reg.body.user.twoFactor).toEqual({ required: false, enabled: false, verified: false });
    await http.post('/api/auth/2fa/setup').set('authorization', bearer(reg.body.accessToken)).expect(403);
    await http.get('/api/auth/me').set('authorization', bearer(reg.body.accessToken)).expect(200);
  });
});
