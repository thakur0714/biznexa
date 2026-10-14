import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';

@Injectable()
export class WhatsAppChannel implements NotificationChannel {
  readonly channel = 'WHATSAPP' as const;
  private readonly logger = new Logger(WhatsAppChannel.name);

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    // Phase 2 stub: only logs. Strictly NO PII in logs (no phone numbers or message content)!
    this.logger.log(`[WhatsAppChannel] Stub send event=${input.event} user=${input.userId}`);
    return {
      success: true,
      channel: this.channel,
    };
  }
}
