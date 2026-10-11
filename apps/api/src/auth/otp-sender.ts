import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

export type OtpChannelName = 'MOBILE' | 'EMAIL';

/**
 * Sends one-time passwords. Swap providers through SMS_PROVIDER / EMAIL_PROVIDER;
 * business logic never talks to a vendor directly.
 */
export abstract class OtpSender {
  abstract send(channel: OtpChannelName, target: string, code: string, purpose: string): Promise<void>;
}

@Injectable()
export class ConsoleOtpSender extends OtpSender {
  private readonly logger = new Logger('OTP');
  async send(channel: OtpChannelName, target: string, code: string, purpose: string) {
    this.logger.log(`[${channel}] ${purpose} code for ${target}: ${code}`);
  }
}

/** MSG91 OTP API (DLT-registered template required). Email OTP falls back to console until the email module lands. */
@Injectable()
export class Msg91OtpSender extends OtpSender {
  private readonly logger = new Logger('OTP');
  async send(channel: OtpChannelName, target: string, code: string, purpose: string) {
    if (channel === 'EMAIL') {
      this.logger.log(`[EMAIL] ${purpose} code for ${target}: ${code}`);
      return;
    }
    const { MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID } = env();
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.searchParams.set('template_id', MSG91_OTP_TEMPLATE_ID);
    url.searchParams.set('mobile', `91${target}`);
    url.searchParams.set('otp', code);
    const res = await fetch(url, { method: 'POST', headers: { authkey: MSG91_AUTH_KEY, 'content-type': 'application/json' } });
    if (!res.ok) {
      this.logger.error(`MSG91 send failed: ${res.status}`);
      throw new Error('Could not send OTP. Please try again.');
    }
  }
}

export const otpSenderProvider = {
  provide: OtpSender,
  useFactory: () => (env().SMS_PROVIDER === 'msg91' ? new Msg91OtpSender() : new ConsoleOtpSender()),
};
