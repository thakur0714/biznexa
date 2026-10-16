import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../events/event-bus';

@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.events.on('certificate.issued', async (event) => {
      try {
        await this.handleCertificateIssued(event.payload);
      } catch (err) {
        this.logger.error(`Error handling certificate.issued event: ${err instanceof Error ? err.message : err}`);
      }
    });

    this.events.on('application.status_changed', async (event) => {
      try {
        if (event.payload.to === 'COMPLETED') {
          await this.handleApplicationCompleted(event.payload.applicationId, new Date(event.occurredAt));
        }
      } catch (err) {
        this.logger.error(`Error handling application.status_changed event: ${err instanceof Error ? err.message : err}`);
      }
    });
  }

  private async handleCertificateIssued(payload: { certificateId: string; certificateNumber: string; }) {
    const certificate = await this.prisma.certificate.findUnique({
      where: { id: payload.certificateId },
      include: {
        application: {
          include: {
            service: true,
          },
        },
        businessEntity: true,
      },
    });

    if (!certificate || !certificate.validUntil) return;

    let userId: string | undefined;
    if (certificate.application?.customerId) {
      userId = certificate.application.customerId;
    } else if (certificate.businessEntity?.ownerId) {
      userId = certificate.businessEntity.ownerId;
    }

    if (!userId) return;

    if (certificate.validUntil < new Date()) return;

    let offsets = [30, 15, 7, 1];
    let renewServiceSlug: string | null = null;
    let sourceApplicationId: string | null = null;

    if (certificate.application?.service) {
      if (certificate.application.service.reminderOffsets && certificate.application.service.reminderOffsets.length > 0) {
        offsets = certificate.application.service.reminderOffsets;
      }
      renewServiceSlug = certificate.application.service.slug;
      sourceApplicationId = certificate.application.id;
    }

    const type = 'CERTIFICATE_EXPIRY';
    const title = `${certificate.type} certificate ${certificate.certificateNumber} expires`;

    // Idempotent: same type + sourceApplicationId (+ the same certificate for CERTIFICATE_EXPIRY - put the certificate number in the title and check it)
    // "never create a second reminder with the same type + sourceApplicationId (+ the same certificate for CERTIFICATE_EXPIRY — put the certificate number in the title and check it)"
    const duplicateCheck = await this.prisma.reminder.findFirst({
      where: {
        type,
        title, // check title for certificate number
        sourceApplicationId,
      },
    });

    if (duplicateCheck) return;

    await this.prisma.reminder.create({
      data: {
        userId,
        type,
        title,
        dueDate: certificate.validUntil,
        offsets,
        renewServiceSlug,
        businessEntityId: certificate.businessEntityId,
        sourceApplicationId,
      },
    });
  }

  private async handleApplicationCompleted(applicationId: string, completionTime: Date) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        service: true,
      },
    });

    if (!application || !application.service || !application.service.recurrence) return;

    const recurrenceMap: Record<string, number> = {
      MONTHLY: 1,
      QUARTERLY: 3,
      HALF_YEARLY: 6,
      ANNUAL: 12,
    };

    const monthsToAdd = recurrenceMap[application.service.recurrence];
    if (!monthsToAdd) return;

    const dueDate = addMonthsClamped(completionTime, monthsToAdd);

    if (dueDate < new Date()) return;

    const type = 'SERVICE_RENEWAL';
    const title = `${application.service.name} due again`;

    const duplicateCheck = await this.prisma.reminder.findFirst({
      where: {
        type,
        sourceApplicationId: application.id,
      },
    });

    if (duplicateCheck) return;

    await this.prisma.reminder.create({
      data: {
        userId: application.customerId,
        businessEntityId: application.businessEntityId,
        type,
        title,
        dueDate,
        offsets: application.service.reminderOffsets,
        renewServiceSlug: application.service.slug,
        sourceApplicationId: application.id,
      },
    });
  }
}

/** Adds months, staying on the last day of a shorter month (31 Jan + 1 month = 28/29 Feb, not 3 Mar). */
export function addMonthsClamped(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
