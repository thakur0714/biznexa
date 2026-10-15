import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';
import { FcmProvider } from '../providers/fcm.provider';
import { TemplateEngineService, TemplateNotFoundError } from '../template-engine.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PushChannel implements NotificationChannel {
  readonly channel = 'PUSH' as const;
  private readonly logger = new Logger(PushChannel.name);

  constructor(
    private readonly fcmProvider: FcmProvider,
    private readonly templateEngine: TemplateEngineService,
    private readonly prisma: PrismaService,
  ) {}

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    try {
      // 1. Gather all device tokens for the user (and direct token if provided)
      const userTokens = await this.prisma.deviceToken.findMany({
        where: { userId: input.userId },
        select: { token: true },
      });

      const tokens = Array.from(
        new Set([
          ...(input.recipient?.pushToken ? [input.recipient.pushToken] : []),
          ...userTokens.map((t) => t.token),
        ]),
      );

      if (tokens.length === 0) {
        this.logger.log(`[PushChannel] No registered device tokens for user=${input.userId} event=${input.event}`);
        return {
          success: true,
          channel: this.channel,
          skipped: true,
          reason: 'No device tokens',
        };
      }

      // 2. Render template if available
      const variables: Record<string, unknown> = {
        ...(input.payload ?? {}),
      };

      let title = input.title ?? 'Notification';
      let body = input.body;

      try {
        const rendered = await this.templateEngine.renderTemplate(input.event, 'PUSH', variables);
        if (rendered.subject) {
          title = rendered.subject;
        }
        body = rendered.body;
      } catch (err) {
        if (!(err instanceof TemplateNotFoundError)) {
          throw err;
        }
      }

      // 3. Construct deep-link data payload
      const data: Record<string, string> = {
        event: input.event,
      };

      if (input.link) {
        data.link = input.link;
        data.url = input.link;
        data.click_action = input.link;
      }

      if (input.userId) {
        data.userId = input.userId;
      }

      if (input.payload) {
        for (const [k, v] of Object.entries(input.payload)) {
          if (v !== undefined && v !== null && typeof v !== 'object') {
            data[k] = String(v);
          }
        }
      }

      // 4. Send push to all tokens
      let deliveredCount = 0;
      const errors: string[] = [];

      for (const token of tokens) {
        const res = await this.fcmProvider.send({
          token,
          title,
          body,
          data,
        });

        if (res.unregistered) {
          // On FCM "unregistered" errors, delete that token
          await this.prisma.deviceToken.deleteMany({
            where: { token },
          });
          this.logger.warn(`[PushChannel] Deleted unregistered token: ${token.slice(0, 8)}...`);
        } else if (res.success) {
          deliveredCount++;
        } else if (res.error) {
          errors.push(res.error);
        }
      }

      if (tokens.length > 0 && deliveredCount === 0 && errors.length > 0) {
        return {
          success: false,
          channel: this.channel,
          error: errors.join('; '),
        };
      }

      return {
        success: true,
        channel: this.channel,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[PushChannel] Error sending push for user=${input.userId} event=${input.event}: ${message}`);
      return {
        success: false,
        channel: this.channel,
        error: message,
      };
    }
  }
}
