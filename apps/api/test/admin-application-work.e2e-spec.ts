/**
 * Staff work on applications (M4.3–M4.6): CSV export, detail, assignment and status changes, each within the
 * staff user's scope (D52). Rows are this run's own (codes start with P) and are removed afterwards.
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
const tok: Record<'admin' | 'ops1' | 'ops2' | 'support', string> = { admin: '', ops1: '', ops2: '', support: '' };
const id: Record<string, string> = {};
let pkg: { id: string; serviceId: string; days: number | null };

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
const P = `BNW${run}`;
const email = (n: string) => `e2e-awork-${run}-${n}@example.com`;
const as = (who: keyof typeof tok) => ({ authorization: `Bearer ${tok[who]}` });
let n = 0;

async function make(status: ApplicationStatus, extra: { assignedToId?: string; withOrder?: boolean } = {}) {
  const code = `${P}${++n}`;
  const order = extra.withOrder
    ? await prisma.order.create({ data: { code: `ORD-W${run}-${n}`, customerId: id.customer, subtotal: 100000, total: 118000, status: 'PAID', amountPaid: 118000 } })
    : null;
  const a = await prisma.application.create({
    data: { code, customerId: id.customer, serviceId: pkg.serviceId, packageId: pkg.id, status, assignedToId: extra.assignedToId, orderId: order?.id },
  });
  if (order) await prisma.payment.create({ data: { orderId: order.id, gateway: 'MOCK', amount: 118000, status: 'SUCCESS', paidAt: new Date(), rawWebhook: { secret: 'x' } } });
  return a.id;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  tok.admin = (await staffSession(http, prisma, 'ADMIN', email('admin'))).accessToken;
  tok.ops1 = (await staffSession(http, prisma, 'OPERATIONS', email('ops1'))).accessToken;
  tok.ops2 = (await staffSession(http, prisma, 'OPERATIONS', email('ops2'))).accessToken;
  tok.support = (await staffSession(http, prisma, 'SUPPORT', email('support'))).accessToken;
  for (const u of await prisma.user.findMany({ where: { email: { startsWith: `e2e-awork-${run}-` } }, select: { id: true, email: true } })) {
    id[u.email!.split('-').pop()!.replace('@example.com', '')] = u.id;
  }
  id.customer = (await prisma.user.create({ data: { name: `=Work ${run}`, email: email('cust'), consentAt: new Date() } })).id;
  const p = await prisma.servicePackage.findFirstOrThrow({ where: { service: { estimatedDaysMax: { not: null } } }, select: { id: true, serviceId: true, service: { select: { estimatedDaysMax: true } } } });
  pkg = { id: p.id, serviceId: p.serviceId, days: p.service.estimatedDaysMax };
});

afterAll(async () => {
  const apps = (await prisma.application.findMany({ where: { code: { startsWith: P } }, select: { id: true } })).map((a) => a.id);
  await prisma.auditLog.deleteMany({ where: { entityType: 'Application', entityId: { in: apps } } });
  await prisma.application.deleteMany({ where: { id: { in: apps } } });
  await prisma.payment.deleteMany({ where: { order: { code: { startsWith: `ORD-W${run}-` } } } });
  await prisma.order.deleteMany({ where: { code: { startsWith: `ORD-W${run}-` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-awork-${run}-` } } });
  await app.close();
});

describe('M4.3 export', () => {
  it('exports the visible applications as CSV, escaped, ops only their own; support 403', async () => {
    const mine = await make('SUBMITTED', { assignedToId: id.ops1, withOrder: true });
    await make('SUBMITTED');
    const all = await http.get('/api/admin/applications/export').set(as('admin')).query({ q: P }).expect(200);
    expect(all.headers['content-type']).toContain('text/csv');
    expect(all.headers['content-disposition']).toMatch(/attachment; filename="applications-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = all.text.split('\n');
    expect(lines[0]).toBe('Application code,Order code,Status,Priority,Service,Package,Customer name,Customer email,Assigned to,Created,SLA due');
    expect(lines).toHaveLength(3);
    expect(all.text).toContain(`"'=Work ${run}"`);
    const ops = await http.get('/api/admin/applications/export').set(as('ops1')).query({ q: P }).expect(200);
    expect(ops.text.split('\n')).toHaveLength(2);
    expect(ops.text).toContain((await prisma.application.findUniqueOrThrow({ where: { id: mine } })).code);
    await http.get('/api/admin/applications/export').set(as('support')).expect(403);
  });
});

describe('M4.4 detail', () => {
  it('shows the application to admin and its assignee; 404 for other ops, 403 for support; no raw webhook', async () => {
    const a = await make('SUBMITTED', { assignedToId: id.ops1, withOrder: true });
    const res = await http.get(`/api/admin/applications/${a}`).set(as('admin')).expect(200);
    expect(res.body).toMatchObject({ id: a, status: 'SUBMITTED', customer: { id: id.customer }, assignedTo: { id: id.ops1 }, payments: [{ amount: 118000, status: 'SUCCESS' }] });
    expect(JSON.stringify(res.body)).not.toContain('rawWebhook');
    await http.get(`/api/admin/applications/${a}`).set(as('ops1')).expect(200);
    await http.get(`/api/admin/applications/${a}`).set(as('ops2')).expect(404);
    await http.get(`/api/admin/applications/${a}`).set(as('support')).expect(403);
  });

  it('shows an application that has no order yet', async () => {
    const a = await make('DRAFT');
    const res = await http.get(`/api/admin/applications/${a}`).set(as('admin')).expect(200);
    expect(res.body).toMatchObject({ id: a, order: null, payments: [] });
  });
});

describe('M4.5 assignment', () => {
  it('lists eligible staff (ops in, support out)', async () => {
    const res = await http.get('/api/admin/applications/staff').set(as('admin')).expect(200);
    const ids = (res.body as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([id.ops1, id.ops2, id.admin]));
    expect(ids).not.toContain(id.support);
    expect(ids).not.toContain(id.customer);
  });

  it('assigns, moves DOCUMENTS_APPROVED → ASSIGNED, sets the SLA once, reassigns without moving it, audits', async () => {
    const a = await make('DOCUMENTS_APPROVED');
    await http.patch(`/api/admin/applications/${a}/assignee`).set(as('admin')).send({ assigneeId: id.ops1 }).expect(200);
    const first = await prisma.application.findUniqueOrThrow({ where: { id: a }, include: { history: true } });
    expect(first).toMatchObject({ status: 'ASSIGNED', assignedToId: id.ops1 });
    expect(first.history.map((h) => h.status)).toEqual(['ASSIGNED']);
    expect(first.slaDueAt).toBeInstanceOf(Date);
    const days = (first.slaDueAt!.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(pkg.days);

    await http.patch(`/api/admin/applications/${a}/assignee`).set(as('admin')).send({ assigneeId: id.ops2 }).expect(200);
    const second = await prisma.application.findUniqueOrThrow({ where: { id: a } });
    expect(second).toMatchObject({ status: 'ASSIGNED', assignedToId: id.ops2 });
    expect(second.slaDueAt!.getTime()).toBe(first.slaDueAt!.getTime());

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Application', entityId: a, action: 'application.assign' }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((x) => [x.before, x.after])).toEqual([
      [{ assignedToId: null }, { assignedToId: id.ops1 }],
      [{ assignedToId: id.ops1 }, { assignedToId: id.ops2 }],
    ]);
  });

  it('refuses ineligible assignees (400) and ops assigning (403)', async () => {
    const a = await make('SUBMITTED');
    await http.patch(`/api/admin/applications/${a}/assignee`).set(as('admin')).send({ assigneeId: id.support }).expect(400);
    await http.patch(`/api/admin/applications/${a}/assignee`).set(as('admin')).send({ assigneeId: id.customer }).expect(400);
    await http.patch(`/api/admin/applications/${a}/assignee`).set(as('ops1')).send({ assigneeId: id.ops1 }).expect(403);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: a } })).assignedToId).toBeNull();
  });

  it('bulk-assigns all or nothing', async () => {
    const a = await make('SUBMITTED');
    const b = await make('SUBMITTED');
    await http.post('/api/admin/applications/bulk-assign').set(as('admin')).send({ applicationIds: [a, b], assigneeId: id.ops2 }).expect(201);
    expect((await prisma.application.findMany({ where: { id: { in: [a, b] } } })).map((x) => x.assignedToId)).toEqual([id.ops2, id.ops2]);

    const c = await make('SUBMITTED');
    await http.post('/api/admin/applications/bulk-assign').set(as('admin')).send({ applicationIds: [c, '00000000-0000-4000-8000-000000000000'], assigneeId: id.ops1 }).expect(404);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: c } })).assignedToId).toBeNull();
  });
});

describe('M4.6 status', () => {
  it('moves the status with a stage of the same service; refuses a stage of another service', async () => {
    const a = await make('IN_PROGRESS', { assignedToId: id.ops1 });
    const stage = await prisma.serviceStage.findFirst({ where: { serviceId: pkg.serviceId } });
    const other = await prisma.serviceStage.findFirstOrThrow({ where: { serviceId: { not: pkg.serviceId } } });
    await http.post(`/api/admin/applications/${a}/status`).set(as('ops1')).send({ to: 'ON_HOLD', note: 'Waiting for ROC', stageId: other.id }).expect(400);
    await http.post(`/api/admin/applications/${a}/status`).set(as('ops1')).send({ to: 'ON_HOLD', note: 'Waiting for ROC', ...(stage ? { stageId: stage.id } : {}) }).expect(201);
    const after = await prisma.application.findUniqueOrThrow({ where: { id: a }, include: { history: true } });
    expect(after.status).toBe('ON_HOLD');
    if (stage) expect(after.currentStageId).toBe(stage.id);
    expect(after.history).toMatchObject([{ status: 'ON_HOLD', note: 'Waiting for ROC' }]);
  });

  it('409 for a forbidden move, 400 cancel without reason, 403 ops cancelling, 404 unassigned ops', async () => {
    const a = await make('IN_PROGRESS', { assignedToId: id.ops1 });
    await http.post(`/api/admin/applications/${a}/status`).set(as('ops1')).send({ to: 'DRAFT' }).expect(409);
    await http.post(`/api/admin/applications/${a}/status`).set(as('admin')).send({ to: 'CANCELLED' }).expect(400);
    await http.post(`/api/admin/applications/${a}/status`).set(as('ops1')).send({ to: 'CANCELLED', note: 'No' }).expect(403);
    await http.post(`/api/admin/applications/${a}/status`).set(as('ops2')).send({ to: 'ON_HOLD', note: 'x' }).expect(404);
    await http.post(`/api/admin/applications/${a}/status`).set(as('support')).send({ to: 'ON_HOLD', note: 'x' }).expect(403);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: a } })).status).toBe('IN_PROGRESS');
    await http.post(`/api/admin/applications/${a}/status`).set(as('admin')).send({ to: 'CANCELLED', note: 'Customer asked' }).expect(201);
  });
});
