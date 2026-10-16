import { randomInt } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

let userA: { token: string; id: string; email: string };
let userB: { token: string; id: string; email: string };

// Random part: suites run in parallel and register customers, so a time-only id can repeat across files.
const run = `${Date.now().toString().slice(-4)}${randomInt(100, 1000)}`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerUser(n: number) {
  const email = `e2e-prof-${run}-${n}@example.com`;
  const res = await http
    .post('/api/auth/register')
    .send({
      name: `Prof User ${n}`,
      mobile: `8${run}${String(10 + n).padStart(2, '0')}`,
      email,
      password: 'secretPassword123!',
      consent: true,
    });
  if (res.status !== 201) {
    throw new Error(`Register failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken as string, id: res.body.user.id as string, email };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  userA = await registerUser(1);
  userB = await registerUser(2);
});

afterAll(async () => {
  try {
    await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-prof-${run}` } } });
  } finally {
    await app.close();
  }
});

describe('profile & password API (M5.11)', () => {
  describe('PATCH /api/auth/me', () => {
    it('refuses unauthenticated request with 401', async () => {
      await http.patch('/api/auth/me').send({ name: 'New Name' }).expect(401);
    });

    it('refuses empty update with 400 validation error', async () => {
      await http.patch('/api/auth/me').set(as(userA.token)).send({}).expect(400);
    });

    it('refuses invalid email with 400', async () => {
      await http.patch('/api/auth/me').set(as(userA.token)).send({ email: 'not-an-email' }).expect(400);
    });

    it('updates user name and returns updated user', async () => {
      const res = await http
        .patch('/api/auth/me')
        .set(as(userA.token))
        .send({ name: 'Updated User A' })
        .expect(200);

      expect(res.body.id).toBe(userA.id);
      expect(res.body.name).toBe('Updated User A');
      expect(res.body.email).toBe(userA.email);

      // Verify GET /api/auth/me also reflects the change
      const me = await http.get('/api/auth/me').set(as(userA.token)).expect(200);
      expect(me.body.name).toBe('Updated User A');

      // User B is unaffected
      const meB = await http.get('/api/auth/me').set(as(userB.token)).expect(200);
      expect(meB.body.name).toBe('Prof User 2');
    });

    it('refuses duplicate email with 409 Conflict', async () => {
      await http
        .patch('/api/auth/me')
        .set(as(userA.token))
        .send({ email: userB.email })
        .expect(409);
    });

    it('updates email when unique', async () => {
      const newEmail = `e2e-prof-${run}-updated@example.com`;
      const res = await http
        .patch('/api/auth/me')
        .set(as(userA.token))
        .send({ email: newEmail })
        .expect(200);

      expect(res.body.email).toBe(newEmail);
      userA.email = newEmail;
    });
  });

  describe('POST /api/auth/password/change', () => {
    it('refuses unauthenticated request with 401', async () => {
      await http
        .post('/api/auth/password/change')
        .send({ currentPassword: 'secretPassword123!', newPassword: 'newSecretPass456!' })
        .expect(401);
    });

    it('validates password complexity with 400', async () => {
      await http
        .post('/api/auth/password/change')
        .set(as(userA.token))
        .send({ currentPassword: 'secretPassword123!', newPassword: 'short' })
        .expect(400);

      await http
        .post('/api/auth/password/change')
        .set(as(userA.token))
        .send({ currentPassword: 'secretPassword123!', newPassword: 'letters_only' })
        .expect(400);
    });

    it('refuses wrong current password with 400', async () => {
      await http
        .post('/api/auth/password/change')
        .set(as(userA.token))
        .send({ currentPassword: 'wrongPassword999!', newPassword: 'newSecretPass456!' })
        .expect(400);
    });

    it('successfully changes password and allows login with new password', async () => {
      const res = await http
        .post('/api/auth/password/change')
        .set(as(userA.token))
        .send({ currentPassword: 'secretPassword123!', newPassword: 'newSecretPass456!' })
        .expect(200);

      expect(res.body.message).toContain('Password changed');

      // Old password fails
      await http
        .post('/api/auth/login')
        .send({ email: userA.email, password: 'secretPassword123!' })
        .expect(401);

      // New password succeeds
      const login = await http
        .post('/api/auth/login')
        .send({ email: userA.email, password: 'newSecretPass456!' })
        .expect(200);

      expect(login.body.accessToken).toBeDefined();
      userA.token = login.body.accessToken;
    });
  });

  describe('notification preferences (M5.11)', () => {
    it('refuses unauthenticated requests with 401', async () => {
      await http.get('/api/notifications/preferences').expect(401);
      await http.put('/api/notifications/preferences').send({ marketingOptOut: true }).expect(401);
    });

    it('returns default preferences for user with none set', async () => {
      const res = await http.get('/api/notifications/preferences').set(as(userA.token)).expect(200);
      expect(res.body).toEqual({
        marketingOptOut: false,
        channelPreferences: {},
      });
    });

    it('updates preferences and persists them', async () => {
      const update = {
        marketingOptOut: true,
        channelPreferences: { EMAIL: false, SMS: true },
      };

      const res = await http
        .put('/api/notifications/preferences')
        .set(as(userA.token))
        .send(update)
        .expect(200);

      expect(res.body.marketingOptOut).toBe(true);
      expect(res.body.channelPreferences.EMAIL).toBe(false);
      expect(res.body.channelPreferences.SMS).toBe(true);

      // GET returns the updated preferences
      const getRes = await http.get('/api/notifications/preferences').set(as(userA.token)).expect(200);
      expect(getRes.body.marketingOptOut).toBe(true);
      expect(getRes.body.channelPreferences.EMAIL).toBe(false);
      expect(getRes.body.channelPreferences.SMS).toBe(true);

      // User B still has defaults (data isolation)
      const userBRes = await http.get('/api/notifications/preferences').set(as(userB.token)).expect(200);
      expect(userBRes.body.marketingOptOut).toBe(false);
      expect(userBRes.body.channelPreferences).toEqual({});
    });
  });
});
