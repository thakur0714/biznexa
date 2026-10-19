/**
 * Reviews (M8.12): a customer reviews only their own COMPLETED booking, once; reviews stay hidden until a
 * moderator approves them; approval recalculates the consultant's rating and review count.
 */
import { randomUUID } from 'node:crypto';
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

const run = randomUUID().slice(0, 8);
const emailPrefix = `e2e-review-${run}`;
const users = { email: { startsWith: emailPrefix } };
const slug = `${emailPrefix}-consultant`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

let consultantId: string;
let adminToken: string;
const customers: { token: string; id: string }[] = [];
let bookingSeq = 0;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Reviewer ${n}`, mobile: `7${run.replace(/\D/g, '1').padEnd(7, '1').slice(0, 7)}${String(n).padStart(2, '0')}`, email: `${emailPrefix}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function booking(customerId: string, status: 'COMPLETED' | 'CONFIRMED') {
  const startAt = new Date(Date.now() - 2 * 86_400_000 + bookingSeq * 3_600_000);
  const row = await prisma.booking.create({
    data: {
      code: `BKG-RV-${run}-${++bookingSeq}`, customerId, consultantId, type: 'VIDEO', fee: 80_000, status,
      startAt, endAt: new Date(startAt.getTime() + 30 * 60_000),
    },
    select: { id: true },
  });
  return row.id;
}

const consultantRow = () => prisma.consultant.findUniqueOrThrow({ where: { id: consultantId }, select: { rating: true, reviewCount: true } });
const publicProfile = async () => (await http.get(`/api/public/consultants/${slug}`).expect(200)).body as { verifiedReviews: { id: string }[]; ratingSummary: { reviewCount: number } };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  const consultantUser = await register(0);
  consultantId = (await prisma.consultant.create({
    data: {
      userId: consultantUser.id, slug, category: 'CA', qualification: 'CA', experienceYears: 9, expertise: ['GST'], languages: ['English'],
      city: 'Pune', state: 'Maharashtra', feePerSession: 80_000, consultationTypes: ['VIDEO'], verificationStatus: 'APPROVED',
    },
    select: { id: true },
  })).id;
  for (let n = 1; n <= 2; n++) customers.push(await register(n));
  adminToken = (await staffSession(http, prisma, 'ADMIN', `${emailPrefix}-admin@example.com`)).accessToken;
});

afterAll(async () => {
  const bookings = { consultantId };
  const reviewIds = (await prisma.review.findMany({ where: { consultantId }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actor: users }, { entityType: 'Review', entityId: { in: reviewIds } }] } });
  await prisma.review.deleteMany({ where: { consultantId } });
  await prisma.booking.deleteMany({ where: bookings });
  await prisma.consultant.deleteMany({ where: { id: consultantId } });
  await prisma.refreshToken.deleteMany({ where: { user: users } });
  await prisma.userRole.deleteMany({ where: { user: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('reviews (M8.12)', () => {
  it('only the owner of a COMPLETED booking can review it, and only once', async () => {
    const [alice, bob] = customers;
    const confirmed = await booking(alice.id, 'CONFIRMED');
    await http.post(`/api/bookings/${confirmed}/review`).set(as(alice.token)).send({ rating: 5 }).expect(409);

    const done = await booking(alice.id, 'COMPLETED');
    await http.post(`/api/bookings/${done}/review`).set(as(bob.token)).send({ rating: 1 }).expect(404);
    await http.get(`/api/bookings/${done}/review`).set(as(bob.token)).expect(404);
    await http.post(`/api/bookings/${done}/review`).set(as(alice.token)).send({ rating: 6 }).expect(400);

    const res = await http.post(`/api/bookings/${done}/review`).set(as(alice.token)).send({ rating: 4, text: '  Helpful  ' }).expect(201);
    expect(res.body).toMatchObject({ bookingId: done, rating: 4, text: 'Helpful', status: 'PENDING', moderationReason: null });
    await http.post(`/api/bookings/${done}/review`).set(as(alice.token)).send({ rating: 5 }).expect(409);
    expect((await http.get(`/api/bookings/${done}/review`).set(as(alice.token)).expect(200)).body).toMatchObject({ id: res.body.id, status: 'PENDING' });

    // Pending reviews are not public and do not change the rating yet.
    expect((await publicProfile()).verifiedReviews).toHaveLength(0);
    expect(await consultantRow()).toEqual({ rating: 0, reviewCount: 0 });
  });

  it('moderation needs consultants.manage, approves once, and updates the public rating', async () => {
    const [alice] = customers;
    await http.get('/api/admin/reviews').set(as(alice.token)).expect(403);
    await http.get('/api/admin/reviews?pageSize=101').set(as(adminToken)).expect(400);

    const listRes = await http.get('/api/admin/reviews?page=1&pageSize=20').set(as(adminToken)).expect(200);
    const pending = listRes.body.items as { id: string; rating: number; consultantName: string }[];
    expect(listRes.body).toMatchObject({ page: 1, pageSize: 20 });
    expect(typeof listRes.body.total).toBe('number');
    expect(typeof listRes.body.pages).toBe('number');
    // Page 2 of size 1 is the second row of the full list (empty when there is only one), with the same total.
    const all = (await http.get('/api/admin/reviews?page=1&pageSize=100').set(as(adminToken)).expect(200)).body;
    const pageTwo = (await http.get('/api/admin/reviews?page=2&pageSize=1').set(as(adminToken)).expect(200)).body;
    expect(pageTwo.items.map((r: { id: string }) => r.id)).toEqual(all.items.slice(1, 2).map((r: { id: string }) => r.id));
    expect(pageTwo).toMatchObject({ page: 2, pageSize: 1, total: all.total, pages: all.total });

    const first = pending.find((r) => r.consultantName === 'Reviewer 0');
    expect(first).toMatchObject({ rating: 4 });

    await http.post(`/api/admin/reviews/${first!.id}/moderate`).set(as(alice.token)).send({ status: 'APPROVED' }).expect(403);
    await http.post(`/api/admin/reviews/${first!.id}/moderate`).set(as(adminToken)).send({ status: 'APPROVED' }).expect(201);
    await http.post(`/api/admin/reviews/${first!.id}/moderate`).set(as(adminToken)).send({ status: 'REJECTED', reason: 'Too late' }).expect(409);
    expect(await consultantRow()).toEqual({ rating: 4, reviewCount: 1 });
    const profile = await publicProfile();
    expect(profile.verifiedReviews.map((r) => r.id)).toEqual([first!.id]);
    expect(profile.ratingSummary.reviewCount).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'Review', entityId: first!.id, action: 'review.approved' } })).toBe(1);

    const second = await booking(alice.id, 'COMPLETED');
    const secondReview = (await http.post(`/api/bookings/${second}/review`).set(as(alice.token)).send({ rating: 2 }).expect(201)).body as { id: string };
    await http.post(`/api/admin/reviews/${secondReview.id}/moderate`).set(as(adminToken)).send({ status: 'REJECTED' }).expect(400);
    await http.post(`/api/admin/reviews/${secondReview.id}/moderate`).set(as(adminToken)).send({ status: 'REJECTED', reason: 'Abusive language' }).expect(201);
    expect(await consultantRow()).toEqual({ rating: 4, reviewCount: 1 });
    expect((await http.get(`/api/bookings/${second}/review`).set(as(alice.token)).expect(200)).body).toMatchObject({ status: 'REJECTED', moderationReason: 'Abusive language' });

    const third = await booking(alice.id, 'COMPLETED');
    const thirdReview = (await http.post(`/api/bookings/${third}/review`).set(as(alice.token)).send({ rating: 5 }).expect(201)).body as { id: string };
    await http.post(`/api/admin/reviews/${thirdReview.id}/moderate`).set(as(adminToken)).send({ status: 'APPROVED' }).expect(201);
    expect(await consultantRow()).toEqual({ rating: 4.5, reviewCount: 2 });
  });
});
