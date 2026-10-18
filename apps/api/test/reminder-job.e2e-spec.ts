import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReminderJobService } from '../src/reminders/reminder-job.service';
import { NotificationQueueService } from '../src/notifications/delivery/notification-queue.service';

describe('Reminder Job (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let job: ReminderJobService;
  let notifications: NotificationQueueService;
  let dispatchSpy: jest.SpyInstance;

  let runStr = Date.now().toString(36);
  let prefix = `job-${runStr}`;

  let userA: { id: string; email: string; name: string };
  let entityAId: string;
  let serviceCatSlug: string;
  let serviceSlug: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    job = app.get(ReminderJobService);
    // Sends are queued (M6.3): what the job asks for is what enqueue receives.
    notifications = app.get(NotificationQueueService);
    dispatchSpy = jest.spyOn(notifications, 'enqueue');

    const randMobile = `9${Date.now().toString().slice(-9)}`;

    const user = await prisma.user.create({
      data: {
        name: `User ${runStr}`,
        email: `${prefix}@example.com`,
        mobile: randMobile,
        passwordHash: 'dummy',

      },
    });
    userA = { id: user.id, email: user.email!, name: user.name! };

    const entity = await prisma.businessEntity.create({
      data: {
        ownerId: user.id,
        legalName: `${prefix} Entity`,
        entityType: 'PRIVATE_LIMITED',
      },
    });
    entityAId = entity.id;

    const category = await prisma.category.create({
      data: { slug: `${prefix}-cat`, name: 'Cat' },
    });
    serviceCatSlug = category.slug;

    const service = await prisma.service.create({
      data: {
        slug: `${prefix}-svc`,
        categoryId: category.id,
        name: 'Svc',
        shortDescription: 'Desc',
      },
    });
    serviceSlug = service.slug;
  });

  afterAll(async () => {
    try {
      await prisma.reminder.deleteMany({ where: { userId: userA.id } });
      await prisma.businessEntity.deleteMany({ where: { ownerId: userA.id } });
      await prisma.service.deleteMany({ where: { slug: serviceSlug } });
      await prisma.category.deleteMany({ where: { slug: serviceCatSlug } });
      await prisma.user.deleteMany({ where: { id: userA.id } });
    } finally {
      await app.close();
    }
  });

  beforeEach(() => {
    dispatchSpy.mockClear();
  });

  it('30-day offset triggers once, changes sentOffsets, dispatch is called once with correct variables and link', async () => {
    const dueDate = new Date('2024-05-15T00:00:00Z');

    await prisma.reminder.create({
      data: {
        userId: userA.id,
        businessEntityId: entityAId,
        type: 'CERTIFICATE_EXPIRY',
        title: `ISO 9001 certificate ${prefix}-123 expires`,
        dueDate,
        offsets: [30, 15, 7, 1],
        renewServiceSlug: serviceSlug,
      },
    });

    const now = new Date('2024-04-15T00:00:00Z'); // Exactly 30 days before
    await job.runDue(now);

    const rems = await prisma.reminder.findMany({ where: { userId: userA.id } });
    expect(rems).toHaveLength(1);
    expect(rems[0].sentOffsets).toEqual([30]);
    expect(rems[0].status).toBe('SCHEDULED');

    // Expected dispatches depend on the active templates for 'certificate.expiring'
    // By default there are 5 channels: EMAIL, SMS, PUSH, IN_APP, WHATSAPP.
    expect(dispatchSpy).toHaveBeenCalled();
    const calls = dispatchSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const emailCall = calls.find(c => c[0].channel === 'EMAIL');
    expect(emailCall).toBeDefined();
    if (emailCall) {
       expect(emailCall[0].event).toBe('certificate.expiring');
       expect(emailCall[0].payload.daysLeft).toBe(30);
       expect(emailCall[0].payload.certificateNumber).toBe(`${prefix}-123`);
       expect(emailCall[0].sourceKey).toMatch(/:30$/); // reminder + offset: one notification per offset
       expect(emailCall[0].link).toContain(`/services/${serviceCatSlug}/${serviceSlug}?entity=${entityAId}`);
    }
  });

  it('Running again on the same day triggers nothing', async () => {
    const now = new Date('2024-04-15T12:00:00Z'); // Still 30 days before, later in the day
    await job.runDue(now);

    const rems = await prisma.reminder.findMany({ where: { userId: userA.id } });
    expect(rems[0].sentOffsets).toEqual([30]);

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Next offset triggers again', async () => {
    const now = new Date('2024-04-30T00:00:00Z'); // 15 days before
    await job.runDue(now);

    const rems = await prisma.reminder.findMany({ where: { userId: userA.id } });
    expect(rems[0].sentOffsets).toContain(15);
    expect(rems[0].sentOffsets).toContain(30);

    expect(dispatchSpy).toHaveBeenCalled();
    const emailCall = dispatchSpy.mock.calls.find(c => c[0].channel === 'EMAIL');
    expect(emailCall).toBeDefined();
    if (emailCall) {
       expect(emailCall[0].payload.daysLeft).toBe(15);
    }
  });

  it('Missed days triggers once and adds missed offsets to sentOffsets', async () => {
    // Current sent: [30, 15]. Remaining offsets: 7, 1.
    const now = new Date('2024-05-14T00:00:00Z'); // 1 day before
    // We skipped the 7-day offset check. The job should process the 1-day offset
    // and mark both 7 and 1 as sent.
    await job.runDue(now);

    const rems = await prisma.reminder.findMany({ where: { userId: userA.id } });
    expect(rems[0].sentOffsets.sort((a,b)=>b-a)).toEqual([30, 15, 7, 1]);

    // Should dispatch once for the "1" day offset
    expect(dispatchSpy).toHaveBeenCalled();
    const emailCall = dispatchSpy.mock.calls.find(c => c[0].channel === 'EMAIL');
    expect(emailCall).toBeDefined();
    // One notification for the missed 7-day and the due 1-day offset, telling the real days left.
    expect(dispatchSpy.mock.calls.filter(c => c[0].channel === 'EMAIL')).toHaveLength(1);
    if (emailCall) {
       expect(emailCall[0].payload.daysLeft).toBe(1);
    }

    // Should also mark as SENT since all offsets are now done
    expect(rems[0].status).toBe('SENT');
  });

  it('Marking SENT when done if job runs after all offsets sent', async () => {
    const now = new Date('2024-05-16T00:00:00Z'); // Past due date
    await job.runDue(now);

    const rems = await prisma.reminder.findMany({ where: { userId: userA.id } });
    expect(rems[0].status).toBe('SENT');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('Compliance reminder processing', async () => {
    const dueDate = new Date('2024-06-01T00:00:00Z');

    await prisma.reminder.create({
      data: {
        userId: userA.id,
        type: 'SERVICE_RENEWAL',
        title: `Annual Return due again`,
        dueDate,
        offsets: [15],
      },
    });

    const now = new Date('2024-05-17T00:00:00Z'); // Exactly 15 days before
    await job.runDue(now);

    const rems = await prisma.reminder.findMany({
      where: { userId: userA.id, type: 'SERVICE_RENEWAL' }
    });
    expect(rems[0].sentOffsets).toEqual([15]);
    expect(rems[0].status).toBe('SENT'); // Only one offset

    expect(dispatchSpy).toHaveBeenCalled();
    const emailCall = dispatchSpy.mock.calls.find(c => c[0].channel === 'EMAIL');
    expect(emailCall).toBeDefined();
    if (emailCall) {
       expect(emailCall[0].event).toBe('compliance.reminder');
       expect(emailCall[0].payload.complianceName).toBe(`Annual Return`);
       // without businessEntity, defaults to "your business"
       expect(emailCall[0].payload.entityName).toBe(`your business`);
       // without renewServiceSlug, link is dashboard
       expect(emailCall[0].link).toMatch(/\/dashboard$/);
    }
  });
});
