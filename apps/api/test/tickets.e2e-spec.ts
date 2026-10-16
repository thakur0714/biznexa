import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketsService } from '../src/tickets/tickets.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let ticketsService: TicketsService;

let userA: { token: string; id: string };
let userB: { token: string; id: string };
let adminToken: string;
let supportToken: string;
let opsToken: string;
let supportUserId: string;

const run = Date.now().toString().slice(-7);
const prefix = `TKT-E2E-${run}`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerCustomer(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({
      name: `Ticket User ${run}-${n}`,
      mobile: `9${run}${String(10 + n).padStart(2, '0')}`,
      email: `tkt-user-${run}-${n}@example.com`,
      password: 'secretPassword123!',
      consent: true,
    })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

let catId: string;
let svcId: string;
let pkgId: string;
let appAId: string;
let appBId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  ticketsService = app.get(TicketsService);

  userA = await registerCustomer(1);
  userB = await registerCustomer(2);

  const adminStaff = await staffSession(http, prisma, 'ADMIN', `admin-tkt-${run}@example.com`);
  adminToken = adminStaff.accessToken;

  const supportStaff = await staffSession(http, prisma, 'SUPPORT', `supp-tkt-${run}@example.com`);
  supportToken = supportStaff.accessToken;
  const suppUser = await prisma.user.findUniqueOrThrow({ where: { email: `supp-tkt-${run}@example.com` } });
  supportUserId = suppUser.id;

  const opsStaff = await staffSession(http, prisma, 'OPERATIONS', `ops-tkt-${run}@example.com`);
  opsToken = opsStaff.accessToken;

  // Create service and packages for application linking tests
  const cat = await prisma.category.create({
    data: { name: `${prefix}-Cat`, slug: `${prefix.toLowerCase()}-cat` },
  });
  catId = cat.id;

  const svc = await prisma.service.create({
    data: {
      name: `${prefix}-Svc`,
      slug: `${prefix.toLowerCase()}-svc`,
      categoryId: cat.id,
      shortDescription: 'test svc',
    },
  });
  svcId = svc.id;

  const pkg = await prisma.servicePackage.create({
    data: {
      serviceId: svc.id,
      name: 'Basic',
      professionalFee: 10000,
    },
  });
  pkgId = pkg.id;

  const appA = await prisma.application.create({
    data: {
      code: `${prefix}-A`,
      customerId: userA.id,
      serviceId: svc.id,
      packageId: pkg.id,
      status: 'SUBMITTED',
    },
  });
  appAId = appA.id;

  const appB = await prisma.application.create({
    data: {
      code: `${prefix}-B`,
      customerId: userB.id,
      serviceId: svc.id,
      packageId: pkg.id,
      status: 'SUBMITTED',
    },
  });
  appBId = appB.id;
});

afterAll(async () => {
  try {
    const testTickets = await prisma.ticket.findMany({
      where: {
        OR: [
          { customerId: { in: [userA?.id ?? '', userB?.id ?? ''] } },
          { subject: { contains: run } },
        ],
      },
      select: { id: true },
    });
    const ticketIds = testTickets.map((t) => t.id);

    if (ticketIds.length) {
      const convs = await prisma.conversation.findMany({
        where: { ticketId: { in: ticketIds } },
        select: { id: true },
      });
      const convIds = convs.map((c) => c.id);
      if (convIds.length) {
        await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
        await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
      }
      await prisma.auditLog.deleteMany({ where: { entityType: 'Ticket', entityId: { in: ticketIds } } });
      await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    }

    if (appAId || appBId) {
      await prisma.application.deleteMany({ where: { id: { in: [appAId, appBId].filter(Boolean) } } });
    }
    if (pkgId) await prisma.servicePackage.deleteMany({ where: { id: pkgId } });
    if (svcId) await prisma.service.deleteMany({ where: { id: svcId } });
    if (catId) await prisma.category.deleteMany({ where: { id: catId } });

    await prisma.user.deleteMany({
      where: {
        email: { contains: run },
      },
    });
  } catch (e) {
    // ignore
  } finally {
    if (app) await app.close();
  }
});

describe('M9.1 Ticket API and State Machine (e2e)', () => {
  let ticketAId: string;
  let ticketACode: string;

  describe('Customer Ticket Creation (POST /api/tickets)', () => {
    it('returns 401 when no token is provided', async () => {
      await http.post('/api/tickets').send({ subject: 'No Token', description: 'Description text' }).expect(401);
    });

    it('creates a new ticket for user A (201) with generated code', async () => {
      const res = await http
        .post('/api/tickets')
        .set(as(userA.token))
        .send({
          subject: `Test Ticket ${run}`,
          description: `My test issue description for ${run}`,
          priority: 'HIGH',
          applicationId: appAId,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.code).toMatch(/^TKT-\d{4}-\d{6}$/);
      expect(res.body.status).toBe('OPEN');
      expect(res.body.priority).toBe('HIGH');
      expect(res.body.applicationId).toBe(appAId);
      expect(res.body.applicationCode).toBe(`${prefix}-A`);

      ticketAId = res.body.id;
      ticketACode = res.body.code;
    });

    it('returns 404 when customer attempts to link another customer’s application', async () => {
      await http
        .post('/api/tickets')
        .set(as(userA.token))
        .send({
          subject: `Sneaky Link ${run}`,
          description: `Trying to link user B application`,
          applicationId: appBId,
        })
        .expect(404);
    });

    it('handles concurrent ticket creations safely with unique codes', async () => {
      const creates = Array.from({ length: 5 }, (_, i) =>
        http
          .post('/api/tickets')
          .set(as(userA.token))
          .send({
            subject: `Concurrent Ticket ${run}-${i}`,
            description: `Testing concurrent ticket number allocation`,
          }),
      );

      const results = await Promise.all(creates);
      results.forEach((r) => expect(r.status).toBe(201));
      const codes = results.map((r) => r.body.code);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(5);
    });
  });

  describe('Customer Ticket Listing (GET /api/tickets)', () => {
    it('returns 401 when unauthenticated', async () => {
      await http.get('/api/tickets').expect(401);
    });

    it('returns only user A’s tickets for user A', async () => {
      const res = await http.get('/api/tickets').set(as(userA.token)).expect(200);
      expect(res.body.items).toBeDefined();
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      const allMine = res.body.items.every((t: any) => t.code.startsWith('TKT-'));
      expect(allMine).toBe(true);
      expect(res.body.items.some((t: any) => t.id === ticketAId)).toBe(true);
    });

    it('returns empty list for user B who has not created any tickets yet', async () => {
      const res = await http.get('/api/tickets').set(as(userB.token)).expect(200);
      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });

  describe('Customer Ticket Detail (GET /api/tickets/:id)', () => {
    it('returns 401 when unauthenticated', async () => {
      await http.get(`/api/tickets/${ticketAId}`).expect(401);
    });

    it('allows user A to view own ticket with thread', async () => {
      const res = await http.get(`/api/tickets/${ticketAId}`).set(as(userA.token)).expect(200);
      expect(res.body.id).toBe(ticketAId);
      expect(res.body.code).toBe(ticketACode);
      expect(res.body.thread).toBeDefined();
      expect(Array.isArray(res.body.thread.items)).toBe(true);
    });

    it('returns 404 when user B attempts to view user A’s ticket', async () => {
      await http.get(`/api/tickets/${ticketAId}`).set(as(userB.token)).expect(404);
    });
  });

  describe('Staff Ticket Management (GET & PATCH /api/admin/tickets)', () => {
    it('returns 401 for unauthenticated request to admin tickets', async () => {
      await http.get('/api/admin/tickets').expect(401);
    });

    it('returns 403 for OPERATIONS staff without tickets.manage permission', async () => {
      await http.get('/api/admin/tickets').set(as(opsToken)).expect(403);
    });

    it('allows SUPPORT staff with tickets.manage to list tickets and filter', async () => {
      const res = await http.get('/api/admin/tickets').set(as(supportToken)).expect(200);
      expect(res.body.items).toBeDefined();
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      const found = res.body.items.find((t: any) => t.id === ticketAId);
      expect(found).toBeDefined();
      expect(found.customer.email).toBe(`tkt-user-${run}-1@example.com`);
    });

    it('allows ADMIN staff to get ticket detail with thread', async () => {
      const res = await http.get(`/api/admin/tickets/${ticketAId}`).set(as(adminToken)).expect(200);
      expect(res.body.id).toBe(ticketAId);
      expect(res.body.customer.name).toContain(`Ticket User ${run}-1`);
      expect(res.body.thread).toBeDefined();
    });

    it('returns 404 for non-existent ticket in admin route', async () => {
      await http
        .get('/api/admin/tickets/00000000-0000-0000-0000-000000000000')
        .set(as(supportToken))
        .expect(404);
    });

    it('updates priority via PATCH /api/admin/tickets/:id/priority', async () => {
      const res = await http
        .patch(`/api/admin/tickets/${ticketAId}/priority`)
        .set(as(supportToken))
        .send({ priority: 'URGENT' })
        .expect(200);
      expect(res.body.priority).toBe('URGENT');

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'Ticket', entityId: ticketAId, action: 'ticket.priority' },
      });
      expect(audit).toBeDefined();
      expect((audit?.after as any)?.priority).toBe('URGENT');
    });

    it('updates assignee via PATCH /api/admin/tickets/:id/assignee', async () => {
      const res = await http
        .patch(`/api/admin/tickets/${ticketAId}/assignee`)
        .set(as(supportToken))
        .send({ assignedToId: supportUserId })
        .expect(200);
      expect(res.body.assignedToId).toBe(supportUserId);
      expect(res.body.assignedTo.id).toBe(supportUserId);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'Ticket', entityId: ticketAId, action: 'ticket.assign' },
      });
      expect(audit).toBeDefined();
    });

    it('returns 400 when assigning to an ineligible user (like a customer)', async () => {
      await http
        .patch(`/api/admin/tickets/${ticketAId}/assignee`)
        .set(as(supportToken))
        .send({ assignedToId: userA.id })
        .expect(400);
    });

    it('updates status according to TICKET_TRANSITIONS (OPEN -> IN_PROGRESS)', async () => {
      const res = await http
        .patch(`/api/admin/tickets/${ticketAId}/status`)
        .set(as(supportToken))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      expect(res.body.status).toBe('IN_PROGRESS');
    });

    it('rejects invalid status transition (IN_PROGRESS -> OPEN) with 409', async () => {
      await http
        .patch(`/api/admin/tickets/${ticketAId}/status`)
        .set(as(supportToken))
        .send({ status: 'OPEN' })
        .expect(409);
    });
  });

  describe('Staff and Customer Messaging Flow', () => {
    it('staff posts reply: sets firstResponseAt and moves status to WAITING_FOR_CUSTOMER', async () => {
      const res = await http
        .post(`/api/admin/tickets/${ticketAId}/reply`)
        .set(as(supportToken))
        .send({ body: 'Hello customer, we are working on your issue.' })
        .expect(201);

      expect(res.body.body).toBe('Hello customer, we are working on your issue.');
      expect(res.body.sender.isStaff).toBe(true);

      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketAId } });
      expect(updated.status).toBe('WAITING_FOR_CUSTOMER');
      expect(updated.firstResponseAt).toBeDefined();
      expect(updated.firstResponseAt).not.toBeNull();
    });

    it('second staff reply maintains original firstResponseAt', async () => {
      const beforeTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketAId } });
      const firstResponseTime = beforeTicket.firstResponseAt?.getTime();

      await http
        .post(`/api/admin/tickets/${ticketAId}/reply`)
        .set(as(adminToken))
        .send({ body: 'Followup note from admin.' })
        .expect(201);

      const afterTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketAId } });
      expect(afterTicket.firstResponseAt?.getTime()).toBe(firstResponseTime);
    });

    it('customer A replies to ticket via POST /api/tickets/:id/messages', async () => {
      const res = await http
        .post(`/api/tickets/${ticketAId}/messages`)
        .set(as(userA.token))
        .send({ body: 'Thanks, here is additional info.' })
        .expect(201);

      expect(res.body.body).toBe('Thanks, here is additional info.');
      expect(res.body.sender.isStaff).toBe(false);
    });

    it('customer B receives 404 when posting message to customer A’s ticket', async () => {
      await http
        .post(`/api/tickets/${ticketAId}/messages`)
        .set(as(userB.token))
        .send({ body: 'Intruding message' })
        .expect(404);
    });

    it('staff resolves ticket (WAITING_FOR_CUSTOMER -> RESOLVED)', async () => {
      const res = await http
        .patch(`/api/admin/tickets/${ticketAId}/status`)
        .set(as(supportToken))
        .send({ status: 'RESOLVED' })
        .expect(200);

      expect(res.body.status).toBe('RESOLVED');
      expect(res.body.resolvedAt).not.toBeNull();
    });

    it('customer reply on RESOLVED ticket reopens it to IN_PROGRESS', async () => {
      await http
        .post(`/api/tickets/${ticketAId}/messages`)
        .set(as(userA.token))
        .send({ body: 'Issue is actually not fixed yet!' })
        .expect(201);

      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketAId } });
      expect(ticket.status).toBe('IN_PROGRESS');
      expect(ticket.resolvedAt).toBeNull();
    });

    it('customer reply while WAITING_FOR_CUSTOMER hands it back to the team (IN_PROGRESS)', async () => {
      await prisma.ticket.update({ where: { id: ticketAId }, data: { status: 'WAITING_FOR_CUSTOMER' } });
      await http.post(`/api/tickets/${ticketAId}/messages`).set(as(userA.token)).send({ body: 'Here is the info.' }).expect(201);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketAId } })).status).toBe('IN_PROGRESS');
    });

    it('staff closes ticket (OPEN -> CLOSED)', async () => {
      const res = await http
        .patch(`/api/admin/tickets/${ticketAId}/status`)
        .set(as(supportToken))
        .send({ status: 'CLOSED' })
        .expect(200);

      expect(res.body.status).toBe('CLOSED');
    });

    it('customer reply on CLOSED ticket returns 409', async () => {
      await http
        .post(`/api/tickets/${ticketAId}/messages`)
        .set(as(userA.token))
        .send({ body: 'Can you reopen this closed ticket?' })
        .expect(409);
    });

    it('staff reply on CLOSED ticket returns 409', async () => {
      await http
        .post(`/api/admin/tickets/${ticketAId}/reply`)
        .set(as(supportToken))
        .send({ body: 'Staff trying to reply on closed ticket' })
        .expect(409);
    });
  });

  describe('Daily Auto-close Job (closeResolvedTickets)', () => {
    let oldResolvedTicketId: string;
    let freshResolvedTicketId: string;

    beforeAll(async () => {
      // Create ticket resolved 8 days ago
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const t1 = await prisma.ticket.create({
        data: {
          code: `TKT-${run}-OLD`,
          customerId: userA.id,
          subject: `Old Resolved Ticket ${run}`,
          description: 'Old issue',
          status: 'RESOLVED',
          resolvedAt: eightDaysAgo,
          createdAt: eightDaysAgo,
        },
      });
      oldResolvedTicketId = t1.id;

      // Create ticket resolved 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const t2 = await prisma.ticket.create({
        data: {
          code: `TKT-${run}-NEW`,
          customerId: userA.id,
          subject: `Fresh Resolved Ticket ${run}`,
          description: 'Fresh issue',
          status: 'RESOLVED',
          resolvedAt: twoDaysAgo,
          createdAt: twoDaysAgo,
        },
      });
      freshResolvedTicketId = t2.id;
    });

    it('automatically closes tickets older than 7 days while keeping newer ones resolved', async () => {
      const closed = await ticketsService.closeResolvedTickets(new Date());
      expect(closed).toBeGreaterThanOrEqual(1);

      const oldTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: oldResolvedTicketId } });
      expect(oldTicket.status).toBe('CLOSED');

      const freshTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: freshResolvedTicketId } });
      expect(freshTicket.status).toBe('RESOLVED');
    });
  });
});
