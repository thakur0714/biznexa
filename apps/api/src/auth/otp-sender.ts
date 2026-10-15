import { Injectable } from '@nestjs/common';
import { SmsChannel } from '../notifications/channels/sms.channel';
import { EmailChannel } from '../notifications/channels/email.channel';

export type OtpChannelName = 'MOBILE' | 'EMAIL';

/**
 * Sends one-time passwords through notification channels (SmsChannel and EmailChannel).
 */
export abstract class OtpSender {
  abstract send(channel: OtpChannelName, target: string, code: string, purpose: string): Promise<void>;
}

@Injectable()
export class ChannelOtpSender extends OtpSender {
  constructor(
    private readonly smsChannel: SmsChannel,
    private readonly emailChannel: EmailChannel,
  ) {
    super();
  }

  async send(channel: OtpChannelName, target: string, code: string, purpose: string): Promise<void> {
    if (channel === 'MOBILE') {
      const res = await this.smsChannel.send({
        userId: target,
        channel: 'SMS',
        event: 'auth.otp',
        body: `${code} is your BizNexa verification code. Valid for 5 minutes. Do not share this code.`,
        payload: { otp: code, purpose, validMinutes: '5' },
        recipient: { mobile: target },
      });
      if (!res.success) {
        throw new Error(res.error ?? 'Could not send OTP SMS. Please try again.');
      }
    } else {
      const res = await this.emailChannel.send({
        userId: target,
        channel: 'EMAIL',
        event: 'auth.otp',
        body: `Your BizNexa verification code is ${code}. Valid for 5 minutes.`,
        payload: { otp: code, purpose, validMinutes: '5' },
        recipient: { email: target },
      });
      if (!res.success) {
        throw new Error(res.error ?? 'Could not send OTP Email. Please try again.');
      }
    }
  }
}

export const otpSenderProvider = {
  provide: OtpSender,
  useClass: ChannelOtpSender,
};
