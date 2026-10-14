import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger(EmailChannel.name);

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    // Stub provider (real provider SES/SendGrid arrives in M6.4). No PII in logs!
    this.logger.log(`[EmailChannel] Stub send event=${input.event} user=${input.userId}`);
    return {
      success: true,
      channel: this.channel,
    };
  }
}
