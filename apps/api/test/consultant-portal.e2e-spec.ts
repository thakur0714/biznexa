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
const emailPrefix = `e2e-cportal-${run}`;
const userScope = { email: { startsWith: emailPrefix } };
const as = (token: string) => ({ authorization: `Bearer ${token}` });
let first: { id: string; token: string };
let second: { id: string; token: string };
let customer: { id: string; token: string };
let firstBooking: string;
let secondBooking: string;
let uncompletedBooking: string;
let firstApp: string;
let secondApp: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  const one = await staffSession(http, prisma, 'CONSULTANT', `${emailPrefix}-one@example.com`);
  const two = await staffSession(http, prisma, 'CONSULTANT', `${emailPrefix}-two@example.com`);
  first = { token: one.accessToken, id: (await prisma.user.findUniqueOrThrow({ where: { email: `${emailPrefix}-one@example.com` }, select: { id: true } })).id };
  second = { token: two.accessToken, id: (await prisma.user.findUniqueOrThrow({ where: { email: `${emailPrefix}-two@example.com` }, select: { id: true } })).id };
  const reg = await http.post('/api/auth/register').send({ name: `Customer ${run}`, mobile: `8${run.replace(/\D/g, '1').padEnd(7, '1').slice(0, 7)}01`, email: `${emailPrefix}-customer@example.com`, password: 'Customer@12345', consent: true }).expect(201);
  customer = { id: reg.body.user.id, token: reg.body.accessToken };
  const consultantOne = await prisma.consultant.create({ data: { userId: first.id, slug: `${emailPrefix}-one`, category: 'CA', qualification: 'CA', experienceYears: 5, expertise: ['Tax'], languages: ['English'], city: 'Pune', state: 'Maharashtra', feePerSession: 10_000, commissionPercent: 15, consultationTypes: ['VIDEO'], verificationStatus: 'APPROVED' }, select: { id: true } });
  const consultantTwo = await prisma.consultant.create({ data: { userId: second.id, slug: `${emailPrefix}-two`, category: 'CA', qualification: 'CA', experienceYears: 5, expertise: ['Tax'], languages: ['English'], city: 'Pune', state: 'Maharashtra', feePerSession: 20_000, commissionPercent: 25, consultationTypes: ['VIDEO'], verificationStatus: 'APPROVED' }, select: { id: true } });
  const now = new Date();
  const makeBooking = (code: string, consultantId: string, status: 'COMPLETED' | 'CONFIRMED', fee: number) => prisma.booking.create({ data: { code, customerId: customer.id, consultantId, type: 'VIDEO', startAt: new Date(now.getTime() - 3_600_000), endAt: new Date(now.getTime() - 1_800_000), fee, status }, select: { id: true } });
  firstBooking = (await makeBooking(`BKG-${run}-A`, consultantOne.id, 'COMPLETED', 10_001)).id;
  secondBooking = (await makeBooking(`BKG-${run}-B`, consultantTwo.id, 'COMPLETED', 20_000)).id;
  uncompletedBooking = (await prisma.booking.create({ data: { code: `BKG-${run}-C`, customerId: customer.id, consultantId: consultantOne.id, type: 'VIDEO', startAt: new Date(now.getTime() - 7_200_000), endAt: new Date(now.getTime() - 5_400_000), fee: 10_001, status: 'CONFIRMED' }, select: { id: true } })).id;
  const pkg = await prisma.servicePackage.findFirstOrThrow({ select: { id: true, serviceId: true } });
  const makeApp = (code: string, assignedToId: string) => prisma.application.create({ data: { code, customerId: customer.id, serviceId: pkg.serviceId, packageId: pkg.id, status: 'IN_PROGRESS', assignedToId }, select: { id: true } });
  firstApp = (await makeApp(`CPL${run}A`, first.id)).id;
  secondApp = (await makeApp(`CPL${run}B`, second.id)).id;
  await prisma.conversation.create({ data: { applicationId: firstApp, messages: { create: { senderId: customer.id, body: 'Unread for consultant one' } } } });
  await prisma.bookingStatusHistory.create({ data: { bookingId: firstBooking, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', actorId: first.id } });
  await prisma.bookingStatusHistory.create({ data: { bookingId: secondBooking, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', actorId: second.id } });
});

afterAll(async () => {
  await prisma.message.deleteMany({ where: { conversation: { application: { code: { startsWith: `CPL${run}` } } } } });
  await prisma.conversation.deleteMany({ where: { application: { code: { startsWith: `CPL${run}` } } } });
  await prisma.application.deleteMany({ where: { code: { startsWith: `CPL${run}` } } });
  await prisma.bookingStatusHistory.deleteMany({ where: { booking: { code: { contains: run } } } });
  await prisma.booking.deleteMany({ where: { code: { contains: run } } });
  await prisma.consultant.deleteMany({ where: { user: userScope } });
  await prisma.user.deleteMany({ where: userScope });
  await app.close();
});

describe('consultant portal (M8.13)', () => {
  it('limits every collection to the logged-in consultant and returns completed-only net earnings', async () => {
    const base = '/api/consultants/me/portal';
    const bookings = await http.get(`${base}/bookings`).set(as(first.token)).expect(200);
    expect(bookings.body.items.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining([firstBooking, uncompletedBooking]));
    const apps = await http.get(`${base}/applications`).set(as(first.token)).expect(200);
    expect(apps.body.items.map((a: { id: string }) => a.id)).toEqual([firstApp]);
    const conversations = await http.get(`${base}/conversations`).set(as(first.token)).expect(200);
    expect(conversations.body.items).toEqual([expect.objectContaining({ applicationId: firstApp, unreadCount: 1 })]);
    const earnings = await http.get(`${base}/earnings`).set(as(first.token)).expect(200);
    expect(earnings.body).toMatchObject({ commissionPercent: 15, items: [expect.objectContaining({ bookingId: firstBooking, fee: 10_001, commission: 1_500, net: 8_501 })] });
    expect(earnings.body.items).toHaveLength(1);
    await http.post(`/api/admin/applications/${firstApp}/messages`).set(as(first.token)).send({ body: 'Consultant reply' }).expect(201);
    for (const path of ['bookings', 'applications', 'conversations', 'earnings']) {
      const otherResponse = await http.get(`${base}/${path}`).set(as(second.token)).expect(200);
      expect(JSON.stringify(otherResponse.body)).not.toContain(firstBooking);
      expect(JSON.stringify(otherResponse.body)).not.toContain(firstApp);
      if (path === 'bookings') {
        expect(otherResponse.body.items.map((b: { id: string }) => b.id)).toContain(secondBooking);
        expect(otherResponse.body.items.map((b: { id: string }) => b.id)).not.toContain(uncompletedBooking);
      }
      if (path === 'applications') expect(otherResponse.body.items.map((a: { id: string }) => a.id)).toEqual([secondApp]);
      if (path === 'conversations') expect(otherResponse.body.items).toEqual([]);
      if (path === 'earnings') expect(otherResponse.body.items.map((i: { bookingId: string }) => i.bookingId)).toEqual([secondBooking]);
    }
  });

  it('returns 403 to customers for every consultant portal collection', async () => {
    for (const path of ['bookings', 'applications', 'conversations', 'earnings']) await http.get(`/api/consultants/me/portal/${path}`).set(as(customer.token)).expect(403);
  });
});
