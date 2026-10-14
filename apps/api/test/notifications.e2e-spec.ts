/**
 * In-app inbox e2e tests (M6.7):
 * - list/paging (IN_APP only, newest first, paging fields)
 * - unread count
 * - mark read (owner only, idempotent, 404 for others)
 * - read-all (sets readAt only on unread rows)
 * - 401 without login
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let aliceToken: string;
let bobToken: string;
let aliceId: string;
let bobId: string;

const run = Date.now().toString().slice(-7);
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerUser(n: number) {
  const email = `e2e-notify-${run}-${n}@example.com`;
  const mobile = `7${run}${String(n).padStart(2, '0')}`;
  const res = await http
    .post('/api/auth/register')
    .send({
      name: `User ${n}`,
      email,
      mobile,
      password: 'password123',
      consent: true,
    })
    .expect(201);

  return {
    token: res.body.accessToken as string,
    id: res.body.user.id as string,
  };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  const alice = await registerUser(1);
  aliceToken = alice.token;
  aliceId = alice.id;

  const bob = await registerUser(2);
  bobToken = bob.token;
  bobId = bob.id;
});

afterAll(async () => {
  const users = { email: { startsWith: `e2e-notify-${run}` } };
  await prisma.notification.deleteMany({
    where: { user: users },
  });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('In-app inbox (M6.7)', () => {
  let aliceNotif1Id: string;
  let aliceNotif2Id: string;
  let aliceNotif3Id: string;
  let bobNotif1Id: string;

  beforeAll(async () => {
    // Seed Alice's notifications (3 IN_APP, 1 EMAIL)
    const baseTime = Date.now();

    const n1 = await prisma.notification.create({
      data: {
        userId: aliceId,
        channel: 'IN_APP',
        event: 'application.status_changed',
        title: 'Status Updated: Under Review',
        body: 'Your company registration application is now under review.',
        link: '/dashboard/applications/app-1',
        status: 'DELIVERED',
        createdAt: new Date(baseTime - 3000),
      },
    });
    aliceNotif1Id = n1.id;

    const n2 = await prisma.notification.create({
      data: {
        userId: aliceId,
        channel: 'IN_APP',
        event: 'payment.succeeded',
        title: 'Payment Received',
        body: 'We have received your payment of Rs 4,999.',
        link: '/dashboard/payments/pay-1',
        status: 'DELIVERED',
        createdAt: new Date(baseTime - 2000),
      },
    });
    aliceNotif2Id = n2.id;

    const n3 = await prisma.notification.create({
      data: {
        userId: aliceId,
        channel: 'IN_APP',
        event: 'certificate.issued',
        title: 'Certificate Ready',
        body: 'Your certificate has been issued and is ready for download.',
        link: '/dashboard/certificates/cert-1',
        status: 'DELIVERED',
        createdAt: new Date(baseTime - 1000),
      },
    });
    aliceNotif3Id = n3.id;

    // Alice's email notification (must NOT appear in in-app inbox)
    await prisma.notification.create({
      data: {
        userId: aliceId,
        channel: 'EMAIL',
        event: 'invoice.issued',
        title: 'Invoice for payment',
        body: 'Your invoice is attached.',
        status: 'SENT',
        createdAt: new Date(baseTime),
      },
    });

    // Bob's notifications (1 unread, 1 read)
    const bn1 = await prisma.notification.create({
      data: {
        userId: bobId,
        channel: 'IN_APP',
        event: 'auth.registered',
        title: 'Welcome to BizNexa',
        body: 'Welcome aboard Bob!',
        status: 'DELIVERED',
        createdAt: new Date(baseTime - 5000),
      },
    });
    bobNotif1Id = bn1.id;

    await prisma.notification.create({
      data: {
        userId: bobId,
        channel: 'IN_APP',
        event: 'document.requested',
        title: 'Please upload Aadhaar',
        body: 'We need Aadhaar copy for verification.',
        status: 'DELIVERED',
        readAt: new Date(baseTime - 4000),
        createdAt: new Date(baseTime - 4500),
      },
    });
  });

  describe('Authentication (401 without login)', () => {
    it('returns 401 on GET /api/notifications without login', async () => {
      await http.get('/api/notifications').expect(401);
    });

    it('returns 401 on GET /api/notifications/unread-count without login', async () => {
      await http.get('/api/notifications/unread-count').expect(401);
    });

    it('returns 401 on POST /api/notifications/read-all without login', async () => {
      await http.post('/api/notifications/read-all').expect(401);
    });

    it('returns 401 on POST /api/notifications/:id/read without login', async () => {
      await http.post(`/api/notifications/${aliceNotif1Id}/read`).expect(401);
    });
  });

  describe('Unread count', () => {
    it('returns correct unread count for Alice (3 unread IN_APP, EMAIL excluded)', async () => {
      const res = await http
        .get('/api/notifications/unread-count')
        .set(as(aliceToken))
        .expect(200);

      expect(res.body).toEqual({ count: 3 });
    });

    it('returns correct unread count for Bob (1 unread out of 2 IN_APP)', async () => {
      const res = await http
        .get('/api/notifications/unread-count')
        .set(as(bobToken))
        .expect(200);

      expect(res.body).toEqual({ count: 1 });
    });
  });

  describe('List and paging', () => {
    it('returns logged-in user IN_APP notifications only, newest first, with expected fields', async () => {
      const res = await http
        .get('/api/notifications')
        .set(as(aliceToken))
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.items).toHaveLength(3);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);

      // Newest first: n3, n2, n1
      expect(res.body.items[0].id).toBe(aliceNotif3Id);
      expect(res.body.items[1].id).toBe(aliceNotif2Id);
      expect(res.body.items[2].id).toBe(aliceNotif1Id);

      // Check fields
      const item = res.body.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('event', 'certificate.issued');
      expect(item).toHaveProperty('title', 'Certificate Ready');
      expect(item).toHaveProperty('body', 'Your certificate has been issued and is ready for download.');
      expect(item).toHaveProperty('link', '/dashboard/certificates/cert-1');
      expect(item).toHaveProperty('readAt', null);
      expect(item).toHaveProperty('createdAt');
      expect(typeof item.createdAt).toBe('string');
    });

    it('supports page paging with limit and page', async () => {
      const page1 = await http
        .get('/api/notifications?limit=2&page=1')
        .set(as(aliceToken))
        .expect(200);

      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(3);
      expect(page1.body.page).toBe(1);
      expect(page1.body.limit).toBe(2);
      expect(page1.body.pages).toBe(2);
      expect(page1.body.items[0].id).toBe(aliceNotif3Id);
      expect(page1.body.items[1].id).toBe(aliceNotif2Id);

      const page2 = await http
        .get('/api/notifications?limit=2&page=2')
        .set(as(aliceToken))
        .expect(200);

      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.total).toBe(3);
      expect(page2.body.page).toBe(2);
      expect(page2.body.items[0].id).toBe(aliceNotif1Id);
    });

    it('supports cursor paging', async () => {
      // First page with limit 1
      const res1 = await http
        .get('/api/notifications?limit=1')
        .set(as(aliceToken))
        .expect(200);

      expect(res1.body.items).toHaveLength(1);
      expect(res1.body.items[0].id).toBe(aliceNotif3Id);
      expect(res1.body.nextCursor).toBe(aliceNotif3Id);

      // Next page using cursor
      const res2 = await http
        .get(`/api/notifications?limit=1&cursor=${res1.body.nextCursor}`)
        .set(as(aliceToken))
        .expect(200);

      expect(res2.body.items).toHaveLength(1);
      expect(res2.body.items[0].id).toBe(aliceNotif2Id);
    });

    it('returns 400 when cursor is unknown or belongs to another user', async () => {
      // Unknown cursor (random UUID)
      const unknownId = randomUUID();
      await http
        .get(`/api/notifications?cursor=${unknownId}`)
        .set(as(aliceToken))
        .expect(400);

      // Cursor belongs to another user (Alice querying with Bob's notification id)
      await http
        .get(`/api/notifications?cursor=${bobNotif1Id}`)
        .set(as(aliceToken))
        .expect(400);
    });

    it('does not expose another user notifications in list', async () => {
      const res = await http
        .get('/api/notifications')
        .set(as(bobToken))
        .expect(200);

      expect(res.body.total).toBe(2);
      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(bobNotif1Id);
      expect(ids).not.toContain(aliceNotif1Id);
      expect(ids).not.toContain(aliceNotif2Id);
      expect(ids).not.toContain(aliceNotif3Id);
    });
  });

  describe('Mark read (POST /api/notifications/:id/read)', () => {
    it('marks a notification as read and is idempotent', async () => {
      // 1. Mark as read
      const res1 = await http
        .post(`/api/notifications/${aliceNotif3Id}/read`)
        .set(as(aliceToken))
        .expect(200);

      expect(res1.body.id).toBe(aliceNotif3Id);
      expect(res1.body.readAt).not.toBeNull();
      const firstReadAt = res1.body.readAt;

      // Unread count should decrease to 2
      const unreadRes = await http
        .get('/api/notifications/unread-count')
        .set(as(aliceToken))
        .expect(200);
      expect(unreadRes.body.count).toBe(2);

      // 2. Mark as read again (idempotent)
      const res2 = await http
        .post(`/api/notifications/${aliceNotif3Id}/read`)
        .set(as(aliceToken))
        .expect(200);

      expect(res2.body.id).toBe(aliceNotif3Id);
      expect(res2.body.readAt).toBe(firstReadAt);
    });

    it('returns 404 when user A attempts to mark user B notification as read', async () => {
      await http
        .post(`/api/notifications/${aliceNotif2Id}/read`)
        .set(as(bobToken))
        .expect(404);
    });

    it('returns 404 for a non-existent notification ID', async () => {
      const randomId = randomUUID();
      await http
        .post(`/api/notifications/${randomId}/read`)
        .set(as(aliceToken))
        .expect(404);
    });
  });

  describe('Mark all as read (POST /api/notifications/read-all)', () => {
    it('sets readAt only on the user unread rows and is idempotent', async () => {
      // Alice currently has 2 unread (n1, n2) and 1 read (n3)
      const res = await http
        .post('/api/notifications/read-all')
        .set(as(aliceToken))
        .expect(200);

      expect(res.body.count).toBe(2);

      // Alice's unread count is now 0
      const aliceCount = await http
        .get('/api/notifications/unread-count')
        .set(as(aliceToken))
        .expect(200);
      expect(aliceCount.body.count).toBe(0);

      // Bob's unread notification was untouched
      const bobCount = await http
        .get('/api/notifications/unread-count')
        .set(as(bobToken))
        .expect(200);
      expect(bobCount.body.count).toBe(1);

      // Calling mark-all again on Alice updates 0 rows
      const res2 = await http
        .post('/api/notifications/read-all')
        .set(as(aliceToken))
        .expect(200);
      expect(res2.body.count).toBe(0);
    });
  });
});
