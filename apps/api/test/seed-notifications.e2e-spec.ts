import { PrismaService } from '../src/prisma/prisma.service';
import { seedNotificationTemplates, SEED_NOTIFICATION_TEMPLATES } from '../prisma/seed-notifications';
import { TemplateEngineService } from '../src/notifications/template-engine.service';

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

  it('allows TemplateEngineService to load and render seeded templates', async () => {
    const engine = new TemplateEngineService(prisma);
    const rendered = await engine.renderTemplate('payment.success', 'EMAIL', {
      customerName: 'Rohit Verma',
      amount: 1500,
      orderId: 'ORD-999',
    });

    expect(rendered.subject).toContain('ORD-999');
    expect(rendered.body).toContain('Rohit Verma');
    expect(rendered.body).toContain('1500');
  });
});
