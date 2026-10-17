/**
 * Availability (M8.6): an approved consultant edits their own weekly windows, settings and date exceptions
 * (portal session with 2FA; others get 403), and anyone reads the bookable IST slots of an approved consultant.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { addDays, istDate, istInstant } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { createStaff, STAFF_PASSWORD, staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

const run = randomUUID().slice(0, 8);
const emailPrefix = `e2e-avail-${run}`;
const users = { email: { startsWith: emailPrefix } };
const base = '/api/consultants/me/availability';
const as = (token: string) => ({ authorization: `Bearer ${token}` });

let consultant: { token: string; id: string; slug: string };
let other: { token: string; id: string };
let customer: { token: string; id: string };
let admin: { token: string };
let operations: { token: string };

/** A portal session for a CONSULTANT-role user with a consultant profile in `status`. */
async function consultantSession(label: string, status: 'APPROVED' | 'PENDING' | 'SUSPENDED') {
  const email = `${emailPrefix}-${label}@example.com`;
  const { accessToken } = await staffSession(http, prisma, 'CONSULTANT', email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const slug = `${emailPrefix}-${label}`;
  const row = await prisma.consultant.create({
    data: {
      userId: user.id, slug, category: 'CA', qualification: 'CA', experienceYears: 5, expertise: ['GST'], languages: ['English'],
      city: 'Pune', state: 'Maharashtra', feePerSession: 50_000, consultationTypes: ['VIDEO'], verificationStatus: status,
    },
    select: { id: true },
  });
  return { token: accessToken, id: row.id, userId: user.id, slug };
}

const schedule = (over: Record<string, unknown> = {}) => ({
  sessionMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '10:00', endTime: '12:00' })),
  ...over,
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  consultant = await consultantSession('main', 'APPROVED');
  other = await consultantSession('other', 'APPROVED');
  const adminSession = await staffSession(http, prisma, 'ADMIN', `${emailPrefix}-admin@example.com`);
  admin = { token: adminSession.accessToken };
  const operationsSession = await staffSession(http, prisma, 'OPERATIONS', `${emailPrefix}-operations@example.com`);
  operations = { token: operationsSession.accessToken };
  const reg = await http
    .post('/api/auth/register')
    .send({ name: 'Avail Customer', mobile: `7${Date.now().toString().slice(-9)}`, email: `${emailPrefix}-customer@example.com`, password: 'secret123', consent: true })
    .expect(201);
  customer = { token: reg.body.accessToken, id: reg.body.user.id };
});

afterAll(async () => {
  const consultants = { user: users };
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.booking.deleteMany({ where: { OR: [{ consultant: consultants }, { customer: users }] } });
  await prisma.consultant.deleteMany({ where: consultants });
  await prisma.refreshToken.deleteMany({ where: { user: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('consultant availability (M8.6)', () => {
  it('is only for an approved consultant’s own portal session', async () => {
    await http.get(base).expect(401);
    await http.get(base).set(as(customer.token)).expect(403);
    const pending = await consultantSession('pending', 'PENDING');
    await http.get(base).set(as(pending.token)).expect(403);
    await http.put(base).set(as(pending.token)).send(schedule()).expect(403);
    const suspended = await consultantSession('suspended', 'SUSPENDED');
    await http.post(`${base}/exceptions`).set(as(suspended.token)).send({ date: addDays(istDate(new Date()), 1), isBlocked: true }).expect(403);
    // A consultant session that has not passed 2FA yet gets the portal's 2FA answer.
    const email = `${emailPrefix}-no2fa@example.com`;
    await createStaff(prisma, 'CONSULTANT', email);
    const login = await http.post('/api/auth/login').send({ email, password: STAFF_PASSWORD }).expect(200);
    const res = await http.get(base).set(as(login.body.accessToken)).expect(403);
    expect(res.body.code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('saves settings and replaces the weekly windows, with an audit entry', async () => {
    const empty = (await http.get(base).set(as(consultant.token)).expect(200)).body;
    expect(empty).toMatchObject({ sessionMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 120, weekly: [], exceptions: [] });

    const saved = (await http.put(base).set(as(consultant.token)).send(schedule({ sessionMinutes: 45, bufferMinutes: 15, weekly: [{ weekday: 1, startTime: '14:00', endTime: '18:00' }, { weekday: 1, startTime: '09:00', endTime: '13:00' }] })).expect(200)).body;
    expect(saved).toMatchObject({ sessionMinutes: 45, bufferMinutes: 15, minNoticeMinutes: 0 });
    expect(saved.weekly.map((w: { weekday: number; startTime: string }) => `${w.weekday} ${w.startTime}`)).toEqual(['1 09:00', '1 14:00']);

    const replaced = (await http.put(base).set(as(consultant.token)).send(schedule()).expect(200)).body;
    expect(replaced.weekly).toHaveLength(7);
    expect(replaced.sessionMinutes).toBe(30);

    const audit = await prisma.auditLog.findMany({ where: { actorId: (await prisma.consultant.findUniqueOrThrow({ where: { id: consultant.id } })).userId, action: 'consultant.availability.update' }, orderBy: { createdAt: 'asc' } });
    expect(audit).toHaveLength(2);
    expect(audit[1].before).toMatchObject({ sessionMinutes: 45, bufferMinutes: 15 });

    await http.put(base).set(as(consultant.token)).send(schedule({ weekly: [{ weekday: 1, startTime: '09:00', endTime: '13:00' }, { weekday: 1, startTime: '12:00', endTime: '14:00' }] })).expect(400);
    await http.put(base).set(as(consultant.token)).send(schedule({ weekly: [{ weekday: 1, startTime: '13:00', endTime: '09:00' }] })).expect(400);
    await http.put(base).set(as(consultant.token)).send({ ...schedule(), consultantId: other.id }).expect(400);
  });

  it('adds and removes date exceptions; another consultant’s exception is not found', async () => {
    const tomorrow = addDays(istDate(new Date()), 1);
    const blocked = (await http.post(`${base}/exceptions`).set(as(consultant.token)).send({ date: tomorrow, isBlocked: true }).expect(201)).body;
    expect(blocked.exceptions).toEqual([expect.objectContaining({ date: tomorrow, startTime: '00:00', endTime: '24:00', isBlocked: true })]);
    await http.post(`${base}/exceptions`).set(as(consultant.token)).send({ date: tomorrow, isBlocked: true }).expect(409);
    await http.post(`${base}/exceptions`).set(as(consultant.token)).send({ date: addDays(istDate(new Date()), -1), isBlocked: true }).expect(400);
    await http.post(`${base}/exceptions`).set(as(consultant.token)).send({ date: tomorrow, isBlocked: false }).expect(400);

    const id = blocked.exceptions[0].id as string;
    await http.delete(`${base}/exceptions/${id}`).set(as(other.token)).expect(404);
    const after = (await http.delete(`${base}/exceptions/${id}`).set(as(consultant.token)).expect(200)).body;
    expect(after.exceptions).toEqual([]);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: id }, select: { action: true } })).map((a) => a.action).sort();
    expect(actions).toEqual(['consultant.availability_exception.create', 'consultant.availability_exception.delete']);
  });
});

describe('consultant portal profile and fee approval (M8.7)', () => {
  const profileUrl = '/api/consultants/me/profile';

  it('lets an approved consultant edit their own profile and queues fee changes for admin review', async () => {
    await http.get(profileUrl).expect(401);
    await http.get(profileUrl).set(as(customer.token)).expect(403);
    await http.get(profileUrl).set(as(operations.token)).expect(403);
    const pending = await consultantSession('profile-pending', 'PENDING');
    await http.get(profileUrl).set(as(pending.token)).expect(403);

    const current = (await http.get(profileUrl).set(as(consultant.token)).expect(200)).body;
    expect(current).toMatchObject({ id: consultant.id, feePerSession: 50_000, pendingFeeRequest: null });
    const rejectedFields = [
      { category: 'CS' },
      { qualification: 'CPA' },
      { membershipNo: 'NEW-MEMBERSHIP-1' },
    ];
    const consultantInput = {
      category: current.category, qualification: current.qualification, membershipNo: current.membershipNo,
      experienceYears: current.experienceYears, expertise: current.expertise, languages: current.languages,
      city: current.city, state: current.state, area: current.area, bio: current.bio,
      feePerSession: current.feePerSession, consultationTypes: current.consultationTypes,
    };
    for (const changedField of rejectedFields) {
      const response = await http.put(profileUrl).set(as(consultant.token)).send({ ...consultantInput, ...changedField }).expect(409);
      expect(response.body.message).toBe('Contact support to change your category, qualification or membership number.');
    }
    const unchanged = (await http.get(profileUrl).set(as(consultant.token)).expect(200)).body;
    expect(unchanged).toMatchObject({ category: current.category, qualification: current.qualification, membershipNo: current.membershipNo, city: current.city });
    const updated = (await http.put(profileUrl).set(as(consultant.token)).send({
      category: current.category, qualification: current.qualification, membershipNo: current.membershipNo,
      experienceYears: current.experienceYears, expertise: ['GST', 'Audit'], languages: current.languages,
      city: 'Mumbai', state: current.state, area: current.area, bio: 'Updated bio',
      feePerSession: 75_000, consultationTypes: current.consultationTypes,
    }).expect(200)).body;
    expect(updated).toMatchObject({ city: 'Mumbai', expertise: ['GST', 'Audit'], feePerSession: 50_000, pendingFeeRequest: { requestedFee: 75_000, status: 'PENDING' } });

    const requestId = updated.pendingFeeRequest.id as string;
    const adminBase = `/api/admin/consultants/${consultant.id}/fee-requests/${requestId}`;
    await http.post(`${adminBase}/approve`).set(as(consultant.token)).expect(403);
    await http.post(`${adminBase}/approve`).set(as(operations.token)).expect(403);
    await http.post(`${adminBase}/approve`).set(as(admin.token)).expect(201).expect(({ body }) => expect(body).toMatchObject({ status: 'APPROVED', requestedFee: 75_000 }));
    expect((await http.get(profileUrl).set(as(consultant.token)).expect(200)).body).toMatchObject({ feePerSession: 75_000, pendingFeeRequest: null });

    const second = await http.put(profileUrl).set(as(consultant.token)).send({
      category: current.category, qualification: current.qualification, membershipNo: current.membershipNo,
      experienceYears: current.experienceYears, expertise: current.expertise, languages: current.languages,
      city: 'Mumbai', state: current.state, area: current.area, bio: current.bio,
      feePerSession: 90_000, consultationTypes: current.consultationTypes,
    }).expect(200);
    const rejectBase = `/api/admin/consultants/${consultant.id}/fee-requests/${second.body.pendingFeeRequest.id}`;
    await http.post(`${rejectBase}/reject`).set(as(admin.token)).send({ reason: 'Outside current fee policy' }).expect(201).expect(({ body }) => expect(body).toMatchObject({ status: 'REJECTED', decisionReason: 'Outside current fee policy' }));
    expect((await http.get(profileUrl).set(as(consultant.token)).expect(200)).body).toMatchObject({ feePerSession: 75_000, pendingFeeRequest: null });
    const detail = (await http.get(`/api/admin/consultants/${consultant.id}`).set(as(admin.token)).expect(200)).body;
    expect(detail.feeChangeRequests.map((request: { status: string }) => request.status)).toEqual(['REJECTED', 'APPROVED']);
    await prisma.consultant.update({ where: { id: consultant.id }, data: { feePerSession: 50_000 } });

    const adminEdit = (await http.patch(`/api/admin/consultants/${consultant.id}/profile`).set(as(admin.token)).send({
      category: 'CS', qualification: 'CPA', membershipNo: 'ADMIN-UPDATED',
      experienceYears: detail.experienceYears, expertise: detail.expertise, languages: detail.languages,
      city: detail.city, state: detail.state, area: detail.area, bio: detail.bio,
      feePerSession: 50_000, consultationTypes: detail.consultationTypes,
    }).expect(200)).body;
    expect(adminEdit).toMatchObject({ category: 'CS', qualification: 'CPA', membershipNo: 'ADMIN-UPDATED' });
  });
});

describe('public slots (M8.6)', () => {
  const day = addDays(istDate(new Date()), 2);
  const slotsFor = (slug: string, from = day, to = day) => http.get(`/api/public/consultants/${slug}/slots?from=${from}&to=${to}`);

  beforeAll(async () => {
    await http.put(base).set(as(consultant.token)).send(schedule()).expect(200);
    await prisma.availabilitySlot.deleteMany({ where: { consultantId: consultant.id, date: { not: null } } });
  });

  it('lists IST slots from the weekly schedule, minus blocked hours and confirmed bookings', async () => {
    const all = (await slotsFor(consultant.slug).expect(200)).body;
    expect(all).toMatchObject({ timezone: 'Asia/Kolkata', from: day, to: day, consultant: { slug: consultant.slug, feePerSession: 50_000, sessionMinutes: 30, consultationTypes: ['VIDEO'] } });
    expect(all.consultant).not.toHaveProperty('id');
    expect(all.slots.map((s: { time: string }) => s.time)).toEqual(['10:00', '10:30', '11:00', '11:30']);
    expect(all.slots[0].startAt).toBe(istInstant(day, 600).toISOString());

    await http.post(`${base}/exceptions`).set(as(consultant.token)).send({ date: day, isBlocked: true, startTime: '10:15', endTime: '10:45' }).expect(201);
    await http.post(`${base}/exceptions`).set(as(consultant.token)).send({ date: day, isBlocked: false, startTime: '18:00', endTime: '18:30' }).expect(201);
    await prisma.booking.create({
      data: { code: `E2E-AV-${run}`, customerId: customer.id, consultantId: consultant.id, type: 'VIDEO', startAt: istInstant(day, 660), endAt: istInstant(day, 690), fee: 50_000, status: 'CONFIRMED' },
    });
    const left = (await slotsFor(consultant.slug).expect(200)).body;
    expect(left.slots.map((s: { time: string }) => s.time)).toEqual(['11:30', '18:00']);
  });

  it('defaults to the next 7 days, allows at most 14, and hides unknown or unapproved consultants', async () => {
    const week = (await http.get(`/api/public/consultants/${consultant.slug}/slots`).expect(200)).body;
    expect(week.from).toBe(istDate(new Date()));
    expect(week.to).toBe(addDays(week.from, 6));
    await slotsFor(consultant.slug, day, addDays(day, 13)).expect(200);
    await slotsFor(consultant.slug, day, addDays(day, 14)).expect(400);
    await slotsFor(consultant.slug, day, addDays(day, -1)).expect(400);
    await http.get(`/api/public/consultants/${consultant.slug}/slots?from=2026-02-30`).expect(400);
    await slotsFor('no-such-consultant').expect(404);
    await slotsFor(`${emailPrefix}-pending`).expect(404);
  });
});
