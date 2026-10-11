import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { requiresTwoFactor, type TwoFactorSetup } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField } from '../common/encryption';
import { TokenService } from './token.service';
import { generateTotpSecret, matchTotpStep, totpUri } from './totp';

/** Wrong codes in a row before the account's 2FA check is locked for LOCK_MINUTES. */
export const MAX_TOTP_FAILURES = 5;
const LOCK_MINUTES = 15;

const codeError = (message: string) => new BadRequestException({ statusCode: 400, message, errors: [{ field: 'code', message }] });

/**
 * Staff two-factor authentication with authenticator apps (D27). Setup stores an encrypted secret that
 * only becomes active once a code from it is confirmed. Every accepted code's time step is recorded and
 * that step or any earlier one is refused, so a code cannot be used twice.
 */
@Injectable()
export class TwoFactorService {
  constructor(private readonly prisma: PrismaService, private readonly tokens: TokenService, private readonly audit: AuditService) {}

  private async staffUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { permissions } = await this.tokens.rolesAndPermissions(userId);
    if (!requiresTwoFactor(permissions)) throw new ForbiddenException('Two-factor authentication is only for staff accounts');
    return user;
  }

  /** Starts (or resumes) setup. Asking again before confirming returns the same secret. */
  async setup(userId: string): Promise<TwoFactorSetup> {
    const user = await this.staffUser(userId);
    if (user.totpEnabledAt) throw new ConflictException('Two-factor authentication is already set up for this account');
    let secret = user.totpSecret ? decryptField(user.totpSecret) : null;
    if (!secret) {
      secret = generateTotpSecret();
      await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: encryptField(secret), totpLastStep: null, totpFailures: 0 } });
    }
    const otpauthUrl = totpUri(secret, user.email ?? user.mobile ?? user.name);
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }) };
  }

  /** Confirms setup with a first code and turns 2FA on. */
  async enable(userId: string, code: string, ip?: string) {
    const user = await this.staffUser(userId);
    if (user.totpEnabledAt) throw new ConflictException('Two-factor authentication is already set up for this account');
    if (!user.totpSecret) throw new BadRequestException('Start the setup first');
    await this.check(user, code);
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } });
    await this.audit.log({ actorId: userId, action: 'user.2fa_enabled', entityType: 'User', entityId: userId, ip });
  }

  /** Checks a code at login for an account that already has 2FA on. */
  async verify(userId: string, code: string) {
    const user = await this.staffUser(userId);
    if (!user.totpEnabledAt || !user.totpSecret) throw new BadRequestException('Set up two-factor authentication first');
    await this.check(user, code);
  }

  private async check(user: { id: string; totpSecret: string | null; totpLockedUntil: Date | null }, code: string) {
    if (user.totpLockedUntil && user.totpLockedUntil > new Date()) {
      throw new HttpException(
        { statusCode: 429, message: `Too many wrong codes. Try again after ${LOCK_MINUTES} minutes.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const step = matchTotpStep(decryptField(user.totpSecret!), code);
    if (step === null) return this.fail(user.id, 'That code is not right. Check your authenticator app and try again.');

    // Atomic: only one request can move the last-used step forward, so a replayed or raced code fails.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step, totpFailures: 0, totpLockedUntil: null },
    });
    if (count === 0) return this.fail(user.id, 'This code has already been used. Wait for the next code in your app.');
  }

  private async fail(userId: string, message: string): Promise<never> {
    const { totpFailures } = await this.prisma.user.update({ where: { id: userId }, data: { totpFailures: { increment: 1 } } });
    if (totpFailures >= MAX_TOTP_FAILURES) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { totpFailures: 0, totpLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
      });
      await this.audit.log({ actorId: userId, action: 'user.2fa_locked', entityType: 'User', entityId: userId });
    }
    throw codeError(message);
  }
}
