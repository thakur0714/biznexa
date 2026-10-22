import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationQueueService } from '../notifications/delivery/notification-queue.service';
import { TemplateEngineService } from '../notifications/template-engine.service';
import { env } from '../config/env';
import { inSequence } from '../common/in-sequence';
import { istDay, type NotificationEvent } from '@biznexa/types';
import type { Prisma } from '../generated/prisma/client';

type ReminderWithEntity = Prisma.ReminderGetPayload<{ include: { businessEntity: true } }>;

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
/** Whole days from one IST calendar day (YYYY-MM-DD) to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** The text between `before` and the last `after` in a title, or the whole title when it has another shape. */
function titlePart(title: string, before: string, after: string): string {
  const start = title.indexOf(before);
  const end = title.lastIndexOf(after);
  if (start < 0 || end <= start + before.length) return title;
  return title.slice(start + before.length, end);
}

/** The notification event and template variables for a reminder; null for a type with no template. */
function reminderMessage(reminder: ReminderWithEntity, customerName: string, daysLeft: number): { event: NotificationEvent; variables: Record<string, unknown> } | null {
  const entityName = reminder.businessEntity?.legalName || 'your business';
  if (reminder.type === 'CERTIFICATE_EXPIRY') {
    // title format: ISO 9001 certificate CERT-123 expires
    const certificateNumber = titlePart(reminder.title, 'certificate ', ' expires');
    return { event: 'certificate.expiring', variables: { customerName, certificateNumber, entityName, daysLeft } };
  }
  if (reminder.type === 'SERVICE_RENEWAL') {
    // title format: Annual Return due again
    const complianceName = titlePart(reminder.title, '', ' due again');
    return { event: 'compliance.reminder', variables: { customerName, complianceName, entityName, dueDate: reminder.dueDate.toISOString().split('T')[0] } };
  }
  return null;
}

@Injectable()
export class ReminderJobService {
  private readonly logger = new Logger(ReminderJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationQueueService,
    private readonly templateEngine: TemplateEngineService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Asia/Kolkata' })
  async runDue(now: Date = new Date()) {
    const today = istDay(now);
    const reminders = await this.prisma.reminder.findMany({
      where: { status: 'SCHEDULED' },
      include: { businessEntity: true },
    });

    // One reminder at a time, so a run never opens many DB connections or provider calls at once.
    await inSequence(reminders, async (reminder) => {
      try {
        // Every unsent offset whose day (in India) has come; after downtime several are due at once.
        const dueOffsets = reminder.offsets.filter(
          (o) => !reminder.sentOffsets.includes(o) && today >= istDay(addDays(reminder.dueDate, -o)),
        );
        if (dueOffsets.length === 0) {
          if (reminder.offsets.every((o) => reminder.sentOffsets.includes(o))) {
            await this.prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'SENT' } });
          }
          return;
        }

        // Claim all of them in one atomic update; a parallel run that claimed any of them wins and we send nothing.
        const claimed = await this.prisma.reminder.updateMany({
          where: { id: reminder.id, status: 'SCHEDULED', NOT: { sentOffsets: { hasSome: dueOffsets } } },
          data: { sentOffsets: { push: dueOffsets } },
        });
        if (claimed.count === 0) return;

        const sent = new Set([...reminder.sentOffsets, ...dueOffsets]);
        if (reminder.offsets.every((o) => sent.has(o))) {
          await this.prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'SENT' } });
        }
        // One notification per claim, named by the nearest offset claimed (the one that is due now).
        await this.processDispatch(reminder, daysBetween(today, istDay(reminder.dueDate)), `${reminder.id}:${Math.min(...dueOffsets)}`);
      } catch (err) {
        this.logger.error(`Error processing reminder ${reminder.id}: ${err instanceof Error ? err.message : err}`);
      }
    });
  }

  /** The service page to renew from (with the business preselected), else the dashboard. */
  private async renewLink(reminder: ReminderWithEntity): Promise<string> {
    const dashboard = `${env().PUBLIC_WEB_URL}/dashboard`;
    if (!reminder.renewServiceSlug) return dashboard;
    const service = await this.prisma.service.findUnique({
      where: { slug: reminder.renewServiceSlug },
      include: { category: true },
    });
    if (!service) return dashboard;
    const entity = reminder.businessEntityId ? `?entity=${reminder.businessEntityId}` : '';
    return `${env().PUBLIC_WEB_URL}/services/${service.category.slug}/${reminder.renewServiceSlug}${entity}`;
  }

  private async processDispatch(reminder: ReminderWithEntity, daysLeft: number, sourceKey: string) {
    const link = await this.renewLink(reminder);
    const user = await this.prisma.user.findUnique({
      where: { id: reminder.userId },
    });

    if (!user) {
      this.logger.warn(`User ${reminder.userId} not found for reminder ${reminder.id}`);
      return;
    }

    const message = reminderMessage(reminder, user.name, daysLeft);
    if (!message) {
      this.logger.warn(`Unknown reminder type: ${reminder.type}`);
      return;
    }
    const { event, variables } = message;

    const templates = await this.prisma.notificationTemplate.findMany({
      where: { event, isActive: true },
    });

    // One template per channel; a channel that fails to queue must not stop the others.
    await Promise.all(templates.map(async (template) => {
      try {
        const rendered = this.templateEngine.render(template, variables);
        await this.notifications.enqueue({
          userId: user.id,
          channel: template.channel,
          event,
          sourceKey,
          templateId: template.id,
          title: rendered.subject,
          body: rendered.body,
          payload: variables,
          link,
        });
      } catch (err) {
        this.logger.error(`Failed to queue reminder notification: ${err instanceof Error ? err.message : String(err)}`);
      }
    }));
  }
}
