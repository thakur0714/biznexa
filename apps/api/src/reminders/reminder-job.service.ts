import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcherService } from '../notifications/notification-dispatcher.service';
import { TemplateEngineService } from '../notifications/template-engine.service';
import { env } from '../config/env';
import { NotificationEvent } from '@biznexa/types';

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
    const reminders = await this.prisma.reminder.findMany({
      where: { status: 'SCHEDULED' },
      include: { businessEntity: true },
    });

    for (const reminder of reminders) {
      try {
        const sortedOffsets = [...reminder.offsets].sort((a, b) => b - a);
        let dueOffset: number | null = null;
        const missedOffsets: number[] = [];

        for (const offset of sortedOffsets) {
          if (reminder.sentOffsets.includes(offset)) continue;

          const threshold = new Date(reminder.dueDate);
          threshold.setUTCDate(threshold.getUTCDate() - offset);

          if (now >= threshold) {
            if (dueOffset === null) {
              dueOffset = offset;
            } else {
              missedOffsets.push(offset);
            }
          }
        }

        if (dueOffset === null) {
          const allSent = sortedOffsets.every(o => reminder.sentOffsets.includes(o));
          if (allSent) {
            await this.prisma.reminder.update({
              where: { id: reminder.id },
              data: { status: 'SENT' },
            });
          }
          continue;
        }

        const claimed = await this.prisma.reminder.updateMany({
          where: {
            id: reminder.id,
            NOT: { sentOffsets: { has: dueOffset } },
          },
          data: { sentOffsets: { push: dueOffset } },
        });

        if (claimed.count > 0) {
          await this.processDispatch(reminder, dueOffset, missedOffsets);
        }
      } catch (err) {
        this.logger.error(`Error processing reminder ${reminder.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async processDispatch(reminder: any, dueOffset: number, missedOffsets: number[]) {
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
        daysLeft: dueOffset,
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

    const updatedSentOffsets = [...reminder.sentOffsets, dueOffset, ...missedOffsets];
    const sortedOffsets = [...reminder.offsets].sort((a, b) => b - a);
    const allSent = sortedOffsets.every(o => updatedSentOffsets.includes(o));

    const updateData: any = {};
    if (missedOffsets.length > 0) {
      updateData.sentOffsets = { push: missedOffsets };
    }
    if (allSent) {
      updateData.status = 'SENT';
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.reminder.update({
        where: { id: reminder.id },
        data: updateData,
      });
    }
  }
}
