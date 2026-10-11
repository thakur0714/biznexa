import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../config/env';
import { OtpSender } from './otp-sender';
import type { OtpChannel, OtpPurpose } from '../generated/prisma/enums';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_HOUR = 5;

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService, private readonly sender: OtpSender) {}

  private hash(target: string, purpose: string, code: string) {
    return createHmac('sha256', env().OTP_PEPPER).update(`${target}:${purpose}:${code}`).digest('hex');
  }

  /**
   * Creates and sends a code. Callers decide whether the target is allowed to receive one;
   * pass deliver=false to run all checks without sending (used to avoid account enumeration).
   */
  async issue(channel: OtpChannel, target: string, purpose: OtpPurpose, opts: { ip?: string; deliver?: boolean } = {}) {
    const now = Date.now();
    const recent = await this.prisma.otpCode.findMany({
      where: { target, purpose, createdAt: { gte: new Date(now - 3600_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent[0] && now - recent[0].createdAt.getTime() < OTP_RESEND_SECONDS * 1000) {
      const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - (now - recent[0].createdAt.getTime())) / 1000);
      throw new HttpException({ message: `Please wait ${wait}s before requesting a new code`, retryAfter: wait }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (recent.length >= OTP_MAX_PER_HOUR) {
      throw new HttpException('Too many codes requested. Please try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpCode.create({
      data: {
        channel,
        target,
        purpose,
        codeHash: this.hash(target, purpose, code),
        expiresAt: new Date(now + OTP_TTL_SECONDS * 1000),
        ip: opts.ip,
      },
    });
    if (opts.deliver !== false) await this.sender.send(channel, target, code, purpose);

    const exposeCode = env().NODE_ENV !== 'production' && env().SMS_PROVIDER === 'console' && opts.deliver !== false;
    return { expiresIn: OTP_TTL_SECONDS, resendAfter: OTP_RESEND_SECONDS, ...(exposeCode ? { devCode: code } : {}) };
  }

  /** Throws on a wrong/expired code; marks the code consumed on success. */
  async verify(target: string, purpose: OtpPurpose, code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { target, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This code has expired. Please request a new one.');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpException('Too many wrong attempts. Please request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(target, purpose, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      const updated = await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const left = OTP_MAX_ATTEMPTS - updated.attempts;
      throw new BadRequestException(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Please request a new one.');
    }
    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }
}
