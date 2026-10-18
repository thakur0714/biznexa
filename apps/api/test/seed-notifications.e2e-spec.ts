import { PrismaService } from '../src/prisma/prisma.service';
import { seedNotificationTemplates, SEED_NOTIFICATION_TEMPLATES } from '../prisma/seed-notifications';
import { TemplateEngineService } from '../src/notifications/template-engine.service';
import { NOTIFICATION_EVENTS, getAllowedVariablesForEvent, extractTemplateVariables } from '@biznexa/types';

const prisma = new PrismaService();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seedNotificationTemplates (e2e)', () => {
  it('seeds all templates idempotently', async () => {
    const firstRun = await seedNotificationTemplates(prisma);
    expect(firstRun.count).toBe(SEED_NOTIFICATION_TEMPLATES.length);

    // Re-run should succeed without errors (idempotent upsert)
    const secondRun = await seedNotificationTemplates(prisma);
    expect(secondRun.count).toBe(SEED_NOTIFICATION_TEMPLATES.length);

    const count = await prisma.notificationTemplate.count();
    expect(count).toBeGreaterThanOrEqual(SEED_NOTIFICATION_TEMPLATES.length);
  });

  it('does not overwrite admin edits when seed is re-run', async () => {
    // 1. Ensure template exists
    await seedNotificationTemplates(prisma);

    // 2. Simulate an admin editing a template
    const editedBody = '<p>Custom admin edited body: {{customerName}} paid {{amount}} for {{orderId}}.</p>';
    await prisma.notificationTemplate.update({
      where: {
        event_channel: {
          event: 'payment.succeeded',
          channel: 'EMAIL',
        },
      },
      data: { body: editedBody },
    });

    // 3. Re-run seed
    await seedNotificationTemplates(prisma);

    // 4. Verify the body stays changed
    const afterSeed = await prisma.notificationTemplate.findUniqueOrThrow({
      where: {
        event_channel: {
          event: 'payment.succeeded',
          channel: 'EMAIL',
        },
      },
    });

    expect(afterSeed.body).toBe(editedBody);
  });

  it('allows TemplateEngineService to load and render seeded templates', async () => {
    const engine = new TemplateEngineService(prisma);
    const rendered = await engine.renderTemplate('payment.succeeded', 'EMAIL', {
      customerName: 'Rohit Verma',
      amount: 1500,
      orderId: 'ORD-999',
    });

    expect(rendered.subject).toContain('ORD-999');
    expect(rendered.body).toContain('Rohit Verma');
    expect(rendered.body).toContain('1500');
  });

  describe.each(NOTIFICATION_EVENTS)('seeded templates for event "%s"', (event) => {
    it(`only uses variables allowed for ${event}`, () => {
      const templatesForEvent = SEED_NOTIFICATION_TEMPLATES.filter((t) => t.event === event);
      expect(templatesForEvent.length).toBeGreaterThan(0);

      const allowed = getAllowedVariablesForEvent(event);

      for (const t of templatesForEvent) {
        const text = `${t.subject ?? ''} ${t.body}`;
        const used = extractTemplateVariables(text);
        const disallowed = used.filter((v) => !allowed.includes(v));
        expect(disallowed).toEqual([]);
      }
    });
  });
});
