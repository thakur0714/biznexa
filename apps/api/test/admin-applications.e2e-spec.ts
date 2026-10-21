/**
 * Staff applications list (M4.2): admins see every application, ops and consultants only those assigned to them
 * (filters cannot widen that), others get 403; filters, sorting, paging and validation.
 * Every query is narrowed with `q` to this run's application codes, so other suites' rows never interfere.
 */
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ApplicationStatus } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
const tokens: Record<'admin' | 'ops1' | 'ops2' | 'consultant' | 'support', string> = { admin: '', ops1: '', ops2: '', consultant: '', support: '' };
const ids: Record<string, string> = {};
let customerToken = '';

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
const P = `BNL${run}`; // this run's application codes
const email = (n: string) => `e2e-alist-${run}-${n}@example.com`;
const HOUR = 3_600_000;

const list = (who: keyof typeof tokens, query: Record<string, string | number> = {}) =>
  http.get('/api/admin/applications').set('authorization', `Bearer ${tokens[who]}`).query({ q: P, ...query });
const codes = (res: request.Response) => (res.body.items as { code: string }[]).map((i) => i.code);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  tokens.admin = (await staffSession(http, prisma, 'ADMIN', email('admin'))).accessToken;
  tokens.ops1 = (await staffSession(http, prisma, 'OPERATIONS', email('ops1'))).accessToken;
  tokens.ops2 = (await staffSession(http, prisma, 'OPERATIONS', email('ops2'))).accessToken;
  tokens.consultant = (await staffSession(http, prisma, 'CONSULTANT', email('consultant'))).accessToken;
  tokens.support = (await staffSession(http, prisma, 'SUPPORT', email('support'))).accessToken;
  const staff = await prisma.user.findMany({ where: { email: { in: [email('ops1'), email('ops2')] } }, select: { id: true, email: true } });
  ids.ops1 = staff.find((s) => s.email === email('ops1'))!.id;
  ids.ops2 = staff.find((s) => s.email === email('ops2'))!.id;

  const customer = await http
    .post('/api/auth/register')
    .send({ name: `Listy ${run}`, mobile: `8${run.padStart(9, '0').slice(-9)}`, email: email('cust'), password: 'Customer@12345', consent: true }) // NOSONAR: test credential
    .expect(201);
  customerToken = customer.body.accessToken;
  ids.customer = customer.body.user.id;

  const pkg = await prisma.servicePackage.findFirstOrThrow({ select: { id: true, name: true, serviceId: true } });
  const now = Date.now();
  const make = (n: number, status: ApplicationStatus, extra: { assignedToId?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; slaDueAt?: Date; createdAt?: Date } = {}) =>
    prisma.application.create({ data: { code: `${P}${n}`, customerId: ids.customer, serviceId: pkg.serviceId, packageId: pkg.id, status, ...extra } });
  await make(1, 'SUBMITTED', { assignedToId: ids.ops1, priority: 'HIGH', slaDueAt: new Date(now - HOUR), createdAt: new Date(now - 4 * HOUR) });
  await make(2, 'IN_PROGRESS', { assignedToId: ids.ops2, priority: 'LOW', slaDueAt: new Date(now + 2 * HOUR), createdAt: new Date(now - 3 * HOUR) });
  // 11-Jan-2026 00:10 IST = 10-Jan 18:40 UTC
  await make(3, 'DOCUMENTS_PENDING', { priority: 'URGENT', slaDueAt: new Date(now + 72 * HOUR), createdAt: new Date('2026-01-10T18:40:00Z') });
  await make(4, 'DRAFT', { createdAt: new Date(now - 2 * HOUR) });
  await make(5, 'COMPLETED', { assignedToId: ids.ops1, slaDueAt: new Date(now - 5 * HOUR), createdAt: new Date(now - HOUR) });
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: { code: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-alist-${run}-` } } });
  await app.close();
});

describe('staff applications list (M4.2)', () => {
  it('admin sees every application except drafts, newest first, with customer, service, package and assignee', async () => {
    const res = await list('admin').expect(200);
    expect(codes(res)).toEqual([`${P}5`, `${P}2`, `${P}1`, `${P}3`]);
    expect(res.body.total).toBe(4);
    expect(res.body.items[2]).toMatchObject({
      code: `${P}1`,
      status: 'SUBMITTED',
      priority: 'HIGH',
      customer: { id: ids.customer, name: `Listy ${run}`, email: email('cust') },
      assignedTo: { id: ids.ops1, name: 'E2E OPERATIONS' },
      orderCode: null,
    });
    expect(res.body.items[2].service).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(res.body.items[2].packageName).toEqual(expect.any(String));
  });

  it('ops see only applications assigned to them — never unassigned or someone else’s, whatever the filter', async () => {
    expect(codes(await list('ops1').expect(200))).toEqual([`${P}5`, `${P}1`]);
    expect(codes(await list('ops2').expect(200))).toEqual([`${P}2`]);
    expect((await list('ops1', { assignee: 'unassigned' }).expect(200)).body).toMatchObject({ items: [], total: 0 });
    expect((await list('ops1', { assignee: ids.ops2 }).expect(200)).body).toMatchObject({ items: [], total: 0 });
    expect((await list('ops1', { status: 'DOCUMENTS_PENDING,DRAFT' }).expect(200)).body.total).toBe(0);
    expect(codes(await list('ops1', { assignee: 'me' }).expect(200))).toEqual([`${P}5`, `${P}1`]);
  });

  it('a consultant with nothing assigned sees nothing; support and customers get 403', async () => {
    expect((await list('consultant').expect(200)).body).toMatchObject({ items: [], total: 0 });
    await list('support').expect(403);
    await http.get('/api/admin/applications').set('authorization', `Bearer ${customerToken}`).expect(403);
    await http.get('/api/admin/applications').expect(401);
  });

  it('filters by status (drafts only when asked), assignee, priority and service', async () => {
    expect(codes(await list('admin', { status: 'DRAFT' }).expect(200))).toEqual([`${P}4`]);
    expect(codes(await list('admin', { status: 'SUBMITTED,IN_PROGRESS' }).expect(200))).toEqual([`${P}2`, `${P}1`]);
    expect(codes(await list('admin', { assignee: 'unassigned' }).expect(200))).toEqual([`${P}3`]);
    expect(codes(await list('admin', { assignee: ids.ops1 }).expect(200))).toEqual([`${P}5`, `${P}1`]);
    expect(codes(await list('admin', { priority: 'URGENT' }).expect(200))).toEqual([`${P}3`]);
    const serviceId = (await list('admin').expect(200)).body.items[0].service.id;
    expect((await list('admin', { serviceId }).expect(200)).body.total).toBe(4);
  });

  it('filters by SLA: overdue and due soon skip finished applications', async () => {
    expect(codes(await list('admin', { sla: 'overdue' }).expect(200))).toEqual([`${P}1`]);
    expect(codes(await list('admin', { sla: 'due_soon' }).expect(200))).toEqual([`${P}2`]);
  });

  it('filters by creation day in India (00:10 IST belongs to that day)', async () => {
    expect(codes(await list('admin', { from: '2026-01-11', to: '2026-01-11' }).expect(200))).toEqual([`${P}3`]);
    expect((await list('admin', { from: '2026-01-10', to: '2026-01-10' }).expect(200)).body.total).toBe(0);
  });

  it('searches by the customer’s name, email or mobile as well as the application code', async () => {
    const byName = await http.get('/api/admin/applications').set('authorization', `Bearer ${tokens.admin}`).query({ q: `listy ${run}` }).expect(200);
    expect(byName.body.total).toBe(4);
    const byEmail = await http.get('/api/admin/applications').set('authorization', `Bearer ${tokens.admin}`).query({ q: email('cust') }).expect(200);
    expect(byEmail.body.total).toBe(4);
    expect(codes(await list('admin', { q: `${P}3` }).expect(200))).toEqual([`${P}3`]);
  });

  it('sorts by priority and SLA (no SLA last), and pages', async () => {
    expect(codes(await list('admin', { sort: 'priority', dir: 'desc' }).expect(200))).toEqual([`${P}3`, `${P}1`, `${P}5`, `${P}2`]);
    expect(codes(await list('admin', { sort: 'slaDueAt', dir: 'asc' }).expect(200))).toEqual([`${P}5`, `${P}1`, `${P}2`, `${P}3`]);
    const page2 = await list('admin', { limit: 3, page: 2 }).expect(200);
    expect(page2.body).toMatchObject({ total: 4, page: 2, limit: 3 });
    expect(codes(page2)).toEqual([`${P}3`]);
  });

  it('refuses bad filters with 400', async () => {
    await list('admin', { status: 'ARCHIVED' }).expect(400);
    await list('admin', { from: '2026-02-30' }).expect(400);
    await list('admin', { limit: 500 }).expect(400);
    await list('admin', { assignee: 'someone' }).expect(400);
    await list('admin', { sort: 'customerId' }).expect(400);
  });
});
