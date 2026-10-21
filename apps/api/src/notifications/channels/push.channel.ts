import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';
import { FcmProvider } from '../providers/fcm.provider';
import { TemplateEngineService, TemplateNotFoundError } from '../template-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isPermanentFailure } from '../delivery/delivery-policy';

/** FCM data payload: the event, the deep link (under the keys each platform reads) and the scalar payload values. */
function deepLinkData(input: SendNotificationInput): Record<string, string> {
  const data: Record<string, string> = { event: input.event };
  if (input.link) {
    data.link = input.link;
    data.url = input.link;
    data.click_action = input.link;
  }
  if (input.userId) data.userId = input.userId;
  for (const [k, v] of Object.entries(input.payload ?? {})) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') data[k] = String(v);
  }
  return data;
}

@Injectable()
export class PushChannel implements NotificationChannel {
  readonly channel = 'PUSH' as const;
  private readonly logger = new Logger(PushChannel.name);

  constructor(
    private readonly fcmProvider: FcmProvider,
    private readonly templateEngine: TemplateEngineService,
    private readonly prisma: PrismaService,
  ) {}

  /** The PUSH template when there is one, else the title and body the caller passed. */
  private async render(input: SendNotificationInput): Promise<{ title: string; body: string }> {
    try {
      const rendered = await this.templateEngine.renderTemplate(input.event, 'PUSH', { ...input.payload });
      return { title: rendered.subject || (input.title ?? 'Notification'), body: rendered.body };
    } catch (err) {
      if (!(err instanceof TemplateNotFoundError)) throw err;
      return { title: input.title ?? 'Notification', body: input.body };
    }
  }

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

      const { title, body } = await this.render(input);
      const data = deepLinkData(input);

      // 3. Send to every device at once; an "unregistered" token is deleted.
      const results = await Promise.all(tokens.map(async (token) => {
        const res = await this.fcmProvider.send({ token, title, body, data });
        if (res.unregistered) {
          await this.prisma.deviceToken.deleteMany({ where: { token } });
          this.logger.warn(`[PushChannel] Deleted unregistered token: ${token.slice(0, 8)}...`);
        }
        return res;
      }));
      const deliveredCount = results.filter((res) => !res.unregistered && res.success).length;
      const errors = results.flatMap((res) => (!res.unregistered && !res.success && res.error ? [res.error] : []));

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
        permanent: isPermanentFailure(err),
      };
    }
  }
}
