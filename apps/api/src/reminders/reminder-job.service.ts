import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcherService } from '../notifications/notification-dispatcher.service';
import { TemplateEngineService } from '../notifications/template-engine.service';
import { env } from '../config/env';
import { istDay, type NotificationEvent } from '@biznexa/types';
import type { Prisma } from '../generated/prisma/client';

type ReminderWithEntity = Prisma.ReminderGetPayload<{ include: { businessEntity: true } }>;

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
/** Whole days from one IST calendar day (YYYY-MM-DD) to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

@Injectable()
export class ReminderJobService {
  private readonly logger = new Logger(ReminderJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly templateEngine: TemplateEngineService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Asia/Kolkata' })
  async runDue(now: Date = new Date()) {
    const today = istDay(now);
    const reminders = await this.prisma.reminder.findMany({
      where: { status: 'SCHEDULED' },
      include: { businessEntity: true },
    });

    for (const reminder of reminders) {
      try {
        // Every unsent offset whose day (in India) has come; after downtime several are due at once.
        const dueOffsets = reminder.offsets.filter(
          (o) => !reminder.sentOffsets.includes(o) && today >= istDay(addDays(reminder.dueDate, -o)),
        );
        if (dueOffsets.length === 0) {
          if (reminder.offsets.every((o) => reminder.sentOffsets.includes(o))) {
            await this.prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'SENT' } });
          }
          continue;
        }

        // Claim all of them in one atomic update; a parallel run that claimed any of them wins and we send nothing.
        const claimed = await this.prisma.reminder.updateMany({
          where: { id: reminder.id, status: 'SCHEDULED', NOT: { sentOffsets: { hasSome: dueOffsets } } },
          data: { sentOffsets: { push: dueOffsets } },
        });
        if (claimed.count === 0) continue;

        const sent = [...reminder.sentOffsets, ...dueOffsets];
        if (reminder.offsets.every((o) => sent.includes(o))) {
          await this.prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'SENT' } });
        }
        await this.processDispatch(reminder, daysBetween(today, istDay(reminder.dueDate)));
      } catch (err) {
        this.logger.error(`Error processing reminder ${reminder.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async processDispatch(reminder: ReminderWithEntity, daysLeft: number) {
    let link = `${env().PUBLIC_WEB_URL}/dashboard`;

    if (reminder.renewServiceSlug) {
      const service = await this.prisma.service.findUnique({
        where: { slug: reminder.renewServiceSlug },
        include: { category: true },
      });
      if (service) {
        link = `${env().PUBLIC_WEB_URL}/services/${service.category.slug}/${reminder.renewServiceSlug}`;
        if (reminder.businessEntityId) {
          link += `?entity=${reminder.businessEntityId}`;
        }
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: reminder.userId },
    });

    if (!user) {
      this.logger.warn(`User ${reminder.userId} not found for reminder ${reminder.id}`);
      return;
    }

    let event: NotificationEvent;
    let variables: Record<string, unknown> = {};

    if (reminder.type === 'CERTIFICATE_EXPIRY') {
      event = 'certificate.expiring';
      // title format: ISO 9001 certificate CERT-123 expires
      const certNumberMatch = reminder.title.match(/certificate (.+) expires/);
      const certificateNumber = certNumberMatch ? certNumberMatch[1] : reminder.title;
      variables = {
        customerName: user.name,
        certificateNumber,
        entityName: reminder.businessEntity?.legalName || 'your business',
        daysLeft,
      };
    } else if (reminder.type === 'SERVICE_RENEWAL') {
      event = 'compliance.reminder';
      // title format: Annual Return due again
      const complianceNameMatch = reminder.title.match(/(.+) due again/);
      const complianceName = complianceNameMatch ? complianceNameMatch[1] : reminder.title;
      variables = {
        customerName: user.name,
        complianceName,
        entityName: reminder.businessEntity?.legalName || 'your business',
        dueDate: reminder.dueDate.toISOString().split('T')[0],
      };
    } else {
      this.logger.warn(`Unknown reminder type: ${reminder.type}`);
      return;
    }

    const templates = await this.prisma.notificationTemplate.findMany({
      where: { event, isActive: true },
    });

    for (const template of templates) {
      try {
        const rendered = this.templateEngine.render(template, variables);
        await this.dispatcher.dispatch({
          userId: user.id,
          channel: template.channel,
          event,
          title: rendered.subject,
          body: rendered.body,
          payload: variables,
          link,
          recipient: {
            email: user.email ?? undefined,
            mobile: user.mobile ?? undefined,
          },
        });
      } catch (err) {
        this.logger.error(`Failed to dispatch reminder notification: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
