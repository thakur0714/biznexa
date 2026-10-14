import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { NotificationChannel } from '../notification-channel.interface';

@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly channel = 'IN_APP' as const;
  private readonly logger = new Logger(InAppChannel.name);

  constructor(private readonly prisma: PrismaService) {}

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    try {
      const created = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          channel: 'IN_APP',
          event: input.event,
          title: input.title ?? 'Notification',
          body: input.body,
          link: input.link ?? null,
          payload: input.payload ? (input.payload as Prisma.InputJsonValue) : Prisma.JsonNull,
          status: 'DELIVERED',
        },
      });

      this.logger.log(`[InAppChannel] Created notification id=${created.id} event=${input.event} user=${input.userId}`);

      return {
        success: true,
        channel: this.channel,
        notificationId: created.id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[InAppChannel] Failed to create notification for user=${input.userId} event=${input.event}: ${message}`);
      return {
        success: false,
        channel: this.channel,
        error: message,
      };
    }
  }
}
