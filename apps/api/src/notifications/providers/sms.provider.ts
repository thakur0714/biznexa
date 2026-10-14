import { Logger } from '@nestjs/common';
import { env } from '../../config/env';

export interface SendSmsOptions {
  to: string;
  message: string;
  dltTemplateId: string;
  variables?: Record<string, unknown>;
  otp?: string;
}

export interface SendSmsResult {
  messageId?: string;
}

/**
 * Masks a mobile number to protect customer PII in logs (e.g. 98******10).
 */
export function maskMobile(mobile: string): string {
  const clean = mobile.replace(/\D/g, '');
  if (clean.length < 4) return '****';
  return `${clean.slice(0, 2)}******${clean.slice(-2)}`;
}

/**
 * Provider interface for SMS delivery (MSG91 in production, Fake in dev/test).
 */
export abstract class SmsProvider {
  abstract sendSms(options: SendSmsOptions): Promise<SendSmsResult>;
}

/**
 * Fake SMS provider for dev and test. Logs only the masked mobile.
 */
export class FakeSmsProvider extends SmsProvider {
  private readonly logger = new Logger(FakeSmsProvider.name);
  readonly sentSms: SendSmsOptions[] = [];

  async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
    this.sentSms.push({ ...options });
    // Log only masked mobile in dev/test!
    this.logger.log(`[FakeSmsProvider] Sent SMS to ${maskMobile(options.to)} template=${options.dltTemplateId}`);
    return { messageId: `fake-sms-${Date.now()}-${this.sentSms.length}` };
  }

  clear(): void {
    this.sentSms.length = 0;
  }
}

/**
 * MSG91 SMS Provider (India DLT templates required).
 */
export class Msg91SmsProvider extends SmsProvider {
  private readonly logger = new Logger(Msg91SmsProvider.name);

  constructor(
    private readonly config: {
      authKey: string;
    },
  ) {
    super();
  }

  async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
    // If OTP is provided, use the dedicated MSG91 OTP endpoint
    if (options.otp) {
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.searchParams.set('template_id', options.dltTemplateId);
      url.searchParams.set('mobile', options.to.startsWith('91') ? options.to : `91${options.to}`);
      url.searchParams.set('otp', options.otp);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authkey: this.config.authKey,
          'content-type': 'application/json',
        },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.error(`MSG91 OTP send failed (${res.status}): ${errText}`);
        throw new Error('Could not send OTP SMS. Please try again.');
      }

      return { messageId: `msg91-otp-${Date.now()}` };
    }

    // MSG91 Flow API for transactional SMS
    const url = 'https://control.msg91.com/api/v5/flow/';
    const mobileNumber = options.to.startsWith('91') ? options.to : `91${options.to}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authkey: this.config.authKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        template_id: options.dltTemplateId,
        recipients: [
          {
            mobiles: mobileNumber,
            ...(options.variables ?? {}),
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(`MSG91 send failed (${res.status}): ${errText}`);
      throw new Error('Could not send SMS. Please try again.');
    }

    return { messageId: `msg91-${Date.now()}` };
  }
}

export const smsProviderFactory = {
  provide: SmsProvider,
  useFactory: () => {
    const e = env();
    if (e.SMS_PROVIDER === 'msg91') {
      return new Msg91SmsProvider({ authKey: e.MSG91_AUTH_KEY || '' });
    }
    return new FakeSmsProvider();
  },
};
