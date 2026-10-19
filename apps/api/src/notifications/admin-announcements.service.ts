import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type AnnouncementSegment, type AnnouncementSendInput, userNotificationPreferencesSchema } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationQueueService } from './delivery/notification-queue.service';

const BATCH_SIZE = 100;
@Injectable()
export class AdminAnnouncementsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly queue: NotificationQueueService) {}

  private async eligibleIds(segment: AnnouncementSegment): Promise<string[]> {
    const customerIds = segment.type === 'ALL_CUSTOMERS'
      ? undefined
      : segment.type === 'ACTIVE_APPLICATION_CATEGORY'
        ? (await this.prisma.application.findMany({
            where: { status: { notIn: ['CANCELLED', 'COMPLETED', 'DELIVERED'] }, service: { categoryId: segment.categoryId } },
            select: { customerId: true }, distinct: ['customerId'],
          })).map((row) => row.customerId)
        : (await this.prisma.certificate.findMany({
            where: { status: 'ACTIVE', validUntil: { gte: new Date(), lte: new Date(Date.now() + segment.days * 86_400_000) }, application: { isNot: null } },
            select: { application: { select: { customerId: true } } },
          })).flatMap((row) => row.application?.customerId ?? []);
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { key: 'CUSTOMER' } } }, ...(customerIds ? { id: { in: customerIds } } : {}) },
      select: { id: true, notificationPrefs: true },
    });
    return users.filter((user) => {
      const parsed = userNotificationPreferencesSchema.safeParse(user.notificationPrefs);
      return !parsed.success || !parsed.data.marketingOptOut;
    }).map((user) => user.id);
  }

  async count(segment: AnnouncementSegment) {
    return { recipients: (await this.eligibleIds(segment)).length };
  }

  async send(input: AnnouncementSendInput, actorId: string) {
    const sms = input.channels.includes('SMS');
    if (sms) {
      const template = await this.prisma.notificationTemplate.findFirst({ where: { event: 'announcement.sent', channel: 'SMS', isActive: true, dltTemplateId: { not: null } }, select: { id: true } });
      if (!template) throw new BadRequestException('SMS requires an active DLT template for announcements');
    }
    const users = await this.eligibleIds(input.segment);
    const sourceKey = randomUUID();
    const smsTemplate = input.channels.includes('SMS')
      ? await this.prisma.notificationTemplate.findFirst({ where: { event: 'announcement.sent', channel: 'SMS', isActive: true, dltTemplateId: { not: null } }, select: { id: true } })
      : null;
    let queued = 0;
    // Bound each slice so a large audience does not create an unbounded promise fan-out.
    for (let offset = 0; offset < users.length; offset += BATCH_SIZE) {
      const batch = users.slice(offset, offset + BATCH_SIZE);
      const result = await Promise.all(batch.flatMap((userId) => input.channels.map(async (channel) => {
        const templateId = channel === 'SMS' ? smsTemplate?.id : undefined;
        const row = await this.queue.enqueue({ userId, event: 'announcement.sent', category: 'MARKETING', sourceKey, channel, title: input.title, body: input.body, templateId });
        return row.created ? 1 : 0;
      })));
      queued += result.reduce<number>((sum, n) => sum + n, 0);
    }
    await this.audit.log({ actorId, action: 'notification.announcement.send', entityType: 'NotificationAnnouncement', entityId: sourceKey, after: { title: input.title, body: input.body, channels: input.channels, segment: input.segment, recipients: users.length, queued } });
    return { sourceKey, recipients: users.length, queued };
  }
}
