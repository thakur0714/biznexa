/**
 * Application status changes (M4.1): every allowed move succeeds and every other move is refused with 409
 * against a real database; a change writes status, history and audit in one transaction and emits
 * `application.status_changed` after it commits; concurrent changes from the same status cannot both win.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { APPLICATION_STATUSES, canTransition, type AnyDomainEvent, type ApplicationStatus } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { ApplicationStatusService } from '../src/applications/application-status.service';
import { EventBus } from '../src/events/event-bus';
import { PrismaService } from '../src/prisma/prisma.service';
import { createStaff } from './staff';

let prisma: PrismaService;
let statuses: ApplicationStatusService;
let close: () => Promise<void>;
let staffId: string;
let customerId: string;
let appId: string;
let events: AnyDomainEvent[] = [];

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const codes: string[] = [];

async function newApplication(status: ApplicationStatus) {
  const pkg = await prisma.servicePackage.findFirstOrThrow({ select: { id: true, serviceId: true } });
  const code = `BNT${run}${codes.length}`.slice(0, 20);
  codes.push(code);
  const app = await prisma.application.create({ data: { code, customerId, serviceId: pkg.serviceId, packageId: pkg.id, status } });
  return app.id;
}
const setStatus = (status: ApplicationStatus) => prisma.application.update({ where: { id: appId }, data: { status } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  close = () => app.close();
  prisma = app.get(PrismaService);
  statuses = app.get(ApplicationStatusService);
  app.get(EventBus).onAny((e) => void (e.name === 'application.status_changed' && events.push(e)));
  staffId = await createStaff(prisma, 'OPERATIONS', `e2e-status-${run}-staff@example.com`);
  customerId = (await prisma.user.create({ data: { name: 'Status Test', email: `e2e-status-${run}-cust@example.com`, consentAt: new Date() } })).id;
  appId = await newApplication('DRAFT');
  await prisma.finalDeliverable.create({
    data: { applicationId: appId, title: 'Status matrix fixture', fileKey: `status-matrix-${run}`, fileName: 'status.pdf', uploadedById: staffId },
  });
});

beforeEach(() => {
  events = [];
});

afterAll(async () => {
  const apps = await prisma.application.findMany({ where: { code: { in: codes } }, select: { id: true } });
  const ids = apps.map((a) => a.id);
  await prisma.auditLog.deleteMany({ where: { entityType: 'Application', entityId: { in: ids } } });
  await prisma.application.deleteMany({ where: { id: { in: ids } } }); // history cascades
  await prisma.user.deleteMany({ where: { id: { in: [staffId, customerId] } } });
  await close();
});

describe('application status changes (M4.1)', () => {
  it('allows exactly the moves of the state machine and refuses the rest with 409, changing nothing', async () => {
    for (const from of APPLICATION_STATUSES) {
      for (const to of APPLICATION_STATUSES) {
        await setStatus(from);
        const note = to === 'CANCELLED' ? 'Customer asked to cancel' : undefined;
        if (canTransition('application', from, to)) {
          await expect(statuses.transition({ applicationId: appId, to, actorId: staffId, note })).resolves.toMatchObject({ from, to });
          expect((await prisma.application.findUniqueOrThrow({ where: { id: appId } })).status).toBe(to);
        } else {
          const before = await prisma.applicationStageHistory.count({ where: { applicationId: appId } });
          await expect(statuses.transition({ applicationId: appId, to, actorId: staffId, note })).rejects.toBeInstanceOf(ConflictException);
          expect((await prisma.application.findUniqueOrThrow({ where: { id: appId } })).status).toBe(from);
          expect(await prisma.applicationStageHistory.count({ where: { applicationId: appId } })).toBe(before);
        }
      }
    }
  });

  it('writes status, a history row and an audit entry, then emits application.status_changed', async () => {
    const id = await newApplication('IN_PROGRESS');
    const changed = await statuses.transition({ applicationId: id, to: 'ON_HOLD', actorId: staffId, note: '  Waiting for the ROC  ', visibleToCustomer: false });

    expect(changed).toEqual({ applicationId: id, from: 'IN_PROGRESS', to: 'ON_HOLD', actorId: staffId, reason: 'Waiting for the ROC' });
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe('ON_HOLD');
    expect(await prisma.applicationStageHistory.findMany({ where: { applicationId: id }, select: { status: true, note: true, visibleToCustomer: true, changedById: true } })).toEqual([
      { status: 'ON_HOLD', note: 'Waiting for the ROC', visibleToCustomer: false, changedById: staffId },
    ]);
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Application', entityId: id }, select: { actorId: true, action: true, before: true, after: true } });
    expect(audit).toEqual([
      { actorId: staffId, action: 'application.status_change', before: { status: 'IN_PROGRESS' }, after: { status: 'ON_HOLD', note: 'Waiting for the ROC', visibleToCustomer: false } },
    ]);
    expect(events.map((e) => e.payload)).toEqual([changed]);
  });

  it('shows the history row to the customer by default, records the system as actor, and stamps completedAt', async () => {
    const id = await newApplication('IN_PROGRESS');
    await statuses.transition({ applicationId: id, to: 'COMPLETED', actorId: null });
    const app = await prisma.application.findUniqueOrThrow({ where: { id }, include: { history: true } });
    expect(app.completedAt).toBeInstanceOf(Date);
    expect(app.history).toMatchObject([{ status: 'COMPLETED', note: null, visibleToCustomer: true, changedById: null }]);
  });

  it('needs a reason to cancel, and 404s an unknown application', async () => {
    const id = await newApplication('IN_PROGRESS');
    await expect(statuses.transition({ applicationId: id, to: 'CANCELLED', actorId: staffId })).rejects.toBeInstanceOf(BadRequestException);
    await expect(statuses.transition({ applicationId: id, to: 'CANCELLED', actorId: staffId, note: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe('IN_PROGRESS');
    await expect(statuses.transition({ applicationId: randomUUID(), to: 'IN_PROGRESS', actorId: staffId })).rejects.toBeInstanceOf(NotFoundException);
    expect(events).toEqual([]);
  });

  it('lets only one of two simultaneous changes from the same status win', async () => {
    const id = await newApplication('IN_PROGRESS');
    const results = await Promise.allSettled([
      statuses.transition({ applicationId: id, to: 'ON_HOLD', actorId: staffId }),
      statuses.transition({ applicationId: id, to: 'COMPLETED', actorId: staffId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictException);
    expect(await prisma.applicationStageHistory.count({ where: { applicationId: id } })).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('rolls back with the caller when used inside a larger transaction', async () => {
    const id = await newApplication('IN_PROGRESS');
    await expect(
      prisma.$transaction(async (tx) => {
        await statuses.transitionIn(tx, { applicationId: id, to: 'ON_HOLD', actorId: staffId });
        throw new Error('caller failed later');
      }),
    ).rejects.toThrow('caller failed later');
    expect((await prisma.application.findUniqueOrThrow({ where: { id } })).status).toBe('IN_PROGRESS');
    expect(await prisma.applicationStageHistory.count({ where: { applicationId: id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'Application', entityId: id } })).toBe(0);
  });
});
