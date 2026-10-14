import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';

@Injectable()
export class SmsChannel implements NotificationChannel {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(SmsChannel.name);

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    // Stub provider (real provider MSG91 with DLT template arrives in M6.5). No PII in logs!
    this.logger.log(`[SmsChannel] Stub send event=${input.event} user=${input.userId}`);
    return {
      success: true,
      channel: this.channel,
    };
  }
}
