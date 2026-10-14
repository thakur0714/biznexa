import { Injectable, Logger } from '@nestjs/common';
import type {
  NotificationChannel as NotificationChannelType,
  SendNotificationInput,
  NotificationResult,
} from '@biznexa/types';
import type { NotificationChannel } from './notification-channel.interface';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PushChannel } from './channels/push.channel';
import { InAppChannel } from './channels/in-app.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { NotificationPreferencesService } from './notification-preferences.service';

export class UnknownNotificationChannelError extends Error {
  constructor(channel: string) {
    super(`Unknown notification channel: ${channel}`);
    this.name = 'UnknownNotificationChannelError';
  }
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly channels = new Map<NotificationChannelType, NotificationChannel>();

  constructor(
    private readonly preferencesService: NotificationPreferencesService,
    emailChannel: EmailChannel,
    smsChannel: SmsChannel,
    pushChannel: PushChannel,
    inAppChannel: InAppChannel,
    whatsAppChannel: WhatsAppChannel,
  ) {
    this.registerChannel(emailChannel);
    this.registerChannel(smsChannel);
    this.registerChannel(pushChannel);
    this.registerChannel(inAppChannel);
    this.registerChannel(whatsAppChannel);
  }

  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.channel, channel);
  }

  async dispatch(input: SendNotificationInput): Promise<NotificationResult> {
    const handler = this.channels.get(input.channel);
    if (!handler) {
      throw new UnknownNotificationChannelError(input.channel);
    }

    const category = input.category ?? 'TRANSACTIONAL';

    if (category === 'MARKETING') {
      const preferences = await this.preferencesService.getPreferences(input.userId);

      // Marketing respects opt-out
      if (preferences.marketingOptOut) {
        this.logger.log(`Skipping marketing notification for user=${input.userId} event=${input.event} (marketing opt-out)`);
        return {
          success: true,
          channel: input.channel,
          skipped: true,
          reason: 'opted_out',
        };
      }

      if (preferences.channelPreferences?.[input.channel] === false) {
        this.logger.log(`Skipping marketing notification for user=${input.userId} event=${input.event} (channel ${input.channel} opted out)`);
        return {
          success: true,
          channel: input.channel,
          skipped: true,
          reason: 'channel_opted_out',
        };
      }
    }

    // Transactional is ALWAYS sent, regardless of marketing opt-out or channel opt-outs
    return handler.send(input);
  }
}
