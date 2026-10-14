import { Injectable, Logger } from '@nestjs/common';
import type { SendNotificationInput, NotificationResult } from '@biznexa/types';
import type { NotificationChannel } from '../notification-channel.interface';
import { EmailProvider } from '../providers/email.provider';
import { TemplateEngineService, TemplateNotFoundError } from '../template-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { signedLink } from '../../files/files.service';
import { env } from '../../config/env';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly channel = 'EMAIL' as const;
  private readonly logger = new Logger(EmailChannel.name);

  constructor(
    private readonly provider: EmailProvider,
    private readonly templateEngine: TemplateEngineService,
    private readonly prisma: PrismaService,
  ) {}

  async send(input: SendNotificationInput): Promise<NotificationResult> {
    try {
      // 1. Resolve recipient email without logging it (PII protection)
      let toEmail = input.recipient?.email;
      if (!toEmail && input.userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: input.userId },
          select: { email: true },
        });
        toEmail = user?.email ?? undefined;
      }

      if (!toEmail) {
        this.logger.warn(`[EmailChannel] Skipping email send: no email address for user=${input.userId} event=${input.event}`);
        return {
          success: false,
          channel: this.channel,
          error: 'Recipient email address not found',
        };
      }

      // 2. Prepare variables and invoice link (signed link, no big attachments)
      const variables: Record<string, unknown> = {
        ...(input.payload ?? {}),
      };

      const invoiceId = input.payload?.invoiceId ?? (input.event === 'invoice.issued' && input.payload?.id);
      let signedInvoiceUrl: string | undefined;

      if (invoiceId) {
        const linkResult = signedLink('invoices', String(invoiceId), 'attachment');
        signedInvoiceUrl = `${env().PUBLIC_WEB_URL}${linkResult.url}`;
        if (!variables.invoiceLink) {
          variables.invoiceLink = signedInvoiceUrl;
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
      if (signedInvoiceUrl && !html.includes(signedInvoiceUrl)) {
        html += `<p><a href="${signedInvoiceUrl}" target="_blank" rel="noopener noreferrer">Download Invoice</a></p>`;
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
      };
    }
  }
}
