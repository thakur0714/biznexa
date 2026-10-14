import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';

@Injectable()
export class PushChannel implements NotificationChannel {
  readonly channel = 'PUSH' as const;
  private readonly logger = new Logger(PushChannel.name);

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    // Stub provider (real provider FCM arrives in M6.6). No PII in logs!
    this.logger.log(`[PushChannel] Stub send event=${input.event} user=${input.userId}`);
    return {
      success: true,
      channel: this.channel,
    };
  }
}
