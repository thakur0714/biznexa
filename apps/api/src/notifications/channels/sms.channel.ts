import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';
import { SmsProvider } from '../providers/sms.provider';
import { TemplateEngineService, TemplateNotFoundError } from '../template-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';

@Injectable()
export class SmsChannel implements NotificationChannel {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(SmsChannel.name);

  constructor(
    private readonly provider: SmsProvider,
    private readonly templateEngine: TemplateEngineService,
    private readonly prisma: PrismaService,
  ) {}

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    try {
      // 1. Resolve mobile number without logging it
      let mobile = input.recipient?.mobile;
      if (!mobile && input.userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: input.userId },
          select: { mobile: true },
        });
        mobile = user?.mobile ?? undefined;
      }

      if (!mobile) {
        this.logger.warn(`[SmsChannel] Skipping SMS send: no mobile number for user=${input.userId} event=${input.event}`);
        return {
          success: false,
          channel: this.channel,
          error: 'Recipient mobile number not found',
        };
      }

      // 2. Fetch template to get DLT template ID
      const template = await this.prisma.notificationTemplate.findUnique({
        where: { event_channel: { event: input.event, channel: 'SMS' } },
      });

      let dltTemplateId = template?.dltTemplateId;
      if (!dltTemplateId && input.event === 'auth.otp') {
        // Console provider needs no real DLT id; msg91 refuses to start without one (env.ts).
        dltTemplateId = env().MSG91_OTP_TEMPLATE_ID || (env().SMS_PROVIDER === 'console' ? 'console' : undefined);
      }

      // Refuse to send without DLT template ID (logged without mobile number)
      if (!dltTemplateId) {
        this.logger.error(`[SmsChannel] Refused to send SMS: missing DLT template ID for event=${input.event} user=${input.userId}`);
        return {
          success: false,
          channel: this.channel,
          error: `SMS template for event "${input.event}" has no registered DLT template ID`,
        };
      }

      // 3. Render body from TemplateEngineService
      const variables = { ...(input.payload ?? {}) };
      let text = input.body;

      try {
        const rendered = await this.templateEngine.renderTemplate(input.event, 'SMS', variables);
        text = rendered.body;
      } catch (err) {
        if (!(err instanceof TemplateNotFoundError && input.body)) {
          throw err;
        }
      }

      // 4. Send via SmsProvider
      const result = await this.provider.sendSms({
        to: mobile,
        message: text,
        dltTemplateId,
        variables,
        otp: typeof input.payload?.otp === 'string' ? input.payload.otp : undefined,
      });

      this.logger.log(`[SmsChannel] Sent SMS event=${input.event} user=${input.userId} messageId=${result.messageId ?? 'none'}`);

      return {
        success: true,
        channel: this.channel,
        notificationId: result.messageId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[SmsChannel] Failed to send SMS event=${input.event} user=${input.userId}: ${errorMsg}`);
      return {
        success: false,
        channel: this.channel,
        error: errorMsg,
      };
    }
  }
}
