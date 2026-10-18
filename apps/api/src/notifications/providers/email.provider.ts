import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { isPermanentHttpStatus, PermanentDeliveryError } from '../delivery/delivery-policy';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface SendEmailResult {
  messageId?: string;
}

/**
 * Provider interface for email delivery (SendGrid, SMTP/Mailpit, Fake).
 * Implementations must never log email addresses (PII protection).
 */
export abstract class EmailProvider {
  abstract sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
}

/**
 * Fake provider for dev/test verification in memory.
 */
export class FakeEmailProvider extends EmailProvider {
  readonly sentEmails: SendEmailOptions[] = [];

  sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    this.sentEmails.push({ ...options });
    return Promise.resolve({ messageId: `fake-${Date.now()}-${this.sentEmails.length}` });
  }

  clear(): void {
    this.sentEmails.length = 0;
  }
}

/**
 * SMTP provider using nodemailer (Mailpit in dev/test, or external SMTP).
 */
export class SmtpEmailProvider extends EmailProvider {
  private readonly transporter: Transporter;
  private readonly defaultFrom: string;

  constructor(config: {
    host: string;
    port: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    defaultFrom?: string;
  }) {
    super();
    this.defaultFrom = config.defaultFrom ?? 'BizNexa <no-reply@biznexa.com>';
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? false,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    });
  }


  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const from = options.from || this.defaultFrom;
    const info = await this.transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return { messageId: info.messageId };
  }
}

/**
 * SendGrid REST API provider.
 */
export class SendGridEmailProvider extends EmailProvider {
  private readonly defaultFrom: string;

  constructor(
    private readonly config: {
      apiKey: string;
      defaultFrom?: string;
    },
  ) {
    super();
    this.defaultFrom = config.defaultFrom ?? 'no-reply@biznexa.com';
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const from = options.from || this.defaultFrom;
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: from },
        subject: options.subject,
        content: [{ type: 'text/html', value: options.html }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const message = `SendGrid delivery failed (${res.status}): ${errText}`;
      // 4xx (bad address, rejected content, bad key): retrying sends the same request and fails the same way.
      throw isPermanentHttpStatus(res.status) ? new PermanentDeliveryError(message) : new Error(message);
    }

    const messageId = res.headers.get('x-message-id') ?? undefined;
    return { messageId };
  }
}

export const emailProviderFactory = {
  provide: EmailProvider,
  useFactory: () => {
    const e = env();
    if (e.NODE_ENV === 'test' || e.EMAIL_PROVIDER === 'console') {
      return new FakeEmailProvider();
    }
    switch (e.EMAIL_PROVIDER) {
      case 'sendgrid':
        return new SendGridEmailProvider({
          apiKey: e.SENDGRID_API_KEY || '',
          defaultFrom: e.EMAIL_FROM,
        });
      case 'smtp':
      default:
        return new SmtpEmailProvider({
          host: e.SMTP_HOST || 'localhost',
          port: e.SMTP_PORT || 1025,
          secure: e.SMTP_SECURE,
          user: e.SMTP_USER,
          pass: e.SMTP_PASS,
          defaultFrom: e.EMAIL_FROM,
        });
    }
  },
};
