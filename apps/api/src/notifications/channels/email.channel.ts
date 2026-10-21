import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';
import { EmailProvider } from '../providers/email.provider';
import { TemplateEngineService, TemplateNotFoundError } from '../template-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';
import { isPermanentFailure } from '../delivery/delivery-policy';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger(EmailChannel.name);

  constructor(
    private readonly provider: EmailProvider,
    private readonly templateEngine: TemplateEngineService,
    private readonly prisma: PrismaService,
  ) {}

  private async recipientEmail(input: SendNotificationInput): Promise<string | undefined> {
    if (input.recipient?.email) return input.recipient.email;
    if (!input.userId) return undefined;
    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
    return user?.email ?? undefined;
  }

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    try {
      // 1. Resolve recipient email without logging it (PII protection)
      const toEmail = await this.recipientEmail(input);

      if (!toEmail) {
        this.logger.warn(`[EmailChannel] Skipping email send: no email address for user=${input.userId} event=${input.event}`);
        return {
          success: false,
          channel: this.channel,
          error: 'Recipient email address not found',
          permanent: true,
        };
      }

      // 2. Prepare variables and invoice link. Signed file links last 5 minutes, so the email links to the
      // dashboard, where the customer downloads the PDF after logging in (payments page: M5.10).
      const variables: Record<string, unknown> = { ...input.payload };

      const invoiceId =
        input.payload?.invoiceId ?? (input.event === 'invoice.issued' ? input.payload?.id : undefined);
      let invoiceUrl: string | undefined;

      if (invoiceId) {
        invoiceUrl = `${env().PUBLIC_WEB_URL}/dashboard`;
        if (!variables.invoiceLink) {
          variables.invoiceLink = invoiceUrl;
        }
      }


      // 3. Render subject and body from TemplateEngineService
      let subject = input.title ?? 'Notification from BizNexa';
      let html = input.body;

      try {
        const rendered = await this.templateEngine.renderTemplate(input.event, 'EMAIL', variables);
        subject = rendered.subject ?? subject;
        html = rendered.body;
      } catch (err) {
        if (!(err instanceof TemplateNotFoundError && input.body)) {
          throw err;
        }
      }

      // Append invoice link if invoice was issued and link is not already in HTML
      if (invoiceUrl && !html.includes(invoiceUrl)) {
        html += `<p><a href="${invoiceUrl}" target="_blank" rel="noopener noreferrer">Download Invoice</a></p>`;
      }

      // 4. Send via EmailProvider (never log email addresses!)
      const result = await this.provider.sendEmail({
        to: toEmail,
        subject,
        html,
      });

      this.logger.log(`[EmailChannel] Sent email event=${input.event} user=${input.userId} messageId=${result.messageId ?? 'none'}`);

      return {
        success: true,
        channel: this.channel,
        notificationId: result.messageId,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[EmailChannel] Failed to send email event=${input.event} user=${input.userId}: ${errorMsg}`);
      return {
        success: false,
        channel: this.channel,
        error: errorMsg,
        permanent: isPermanentFailure(err),
      };
    }
  }
}
