import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OtpService } from './otp.service';
import { SessionMeta, TokenService } from './token.service';
import { env } from '../config/env';
import { requiresTwoFactor, type TwoFactorState } from '@biznexa/types';
import type { User } from '../generated/prisma/client';
import type { OtpChannel, OtpPurpose } from '../generated/prisma/enums';

const BCRYPT_ROUNDS = 12;
/** Used when an email isn't registered, so login takes the same time either way. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export interface RegisterDto {
  name: string;
  mobile: string;
  email: string;
  password: string;
  consent: true;
}

@Injectable()
export class AuthService {
  private googleClient?: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
  ) {}

  publicUser(u: User, roles: string[], permissions: string[], twoFactorPending: boolean) {
    const required = requiresTwoFactor(permissions);
    const twoFactor: TwoFactorState = { required, enabled: !!u.totpEnabledAt, verified: required && !twoFactorPending };
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      avatarUrl: u.avatarUrl,
      emailVerified: u.emailVerified,
      mobileVerified: u.mobileVerified,
      roles,
      permissions,
      twoFactor,
    };
  }

  /**
   * Issues an access token + refresh token for a verified user. Every login method lands here without
   * `mfa`, so a staff session always starts with 2FA pending (D27).
   */
  async session(user: User, meta: SessionMeta, mfa = false) {
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active. Please contact support.');
    const [{ token, roles, permissions, twoFactorPending }, refreshToken] = await Promise.all([
      this.tokens.accessToken(user.id, mfa),
      this.tokens.createRefresh(user.id, meta, undefined, mfa ? new Date() : null),
    ]);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { accessToken: token, refreshToken, user: this.publicUser(user, roles, permissions, twoFactorPending) };
  }

  /** After a passed 2FA check: replaces the password-only session with a verified one. */
  async twoFactorSession(userId: string, previousRefreshToken: string | undefined, meta: SessionMeta) {
    if (previousRefreshToken) await this.tokens.revoke(previousRefreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.session(user, meta, true);
  }

  async register(dto: RegisterDto, meta: SessionMeta) {
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email: dto.email }, { mobile: dto.mobile }] } });
    if (existing) {
      throw new BadRequestException(
        existing.email === dto.email ? 'An account with this email already exists. Please log in.' : 'An account with this mobile number already exists. Please log in.',
      );
    }
    const customerRole = await this.prisma.role.findUniqueOrThrow({ where: { key: 'CUSTOMER' } });
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        mobile: dto.mobile,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        consentAt: new Date(),
        roles: { create: { roleId: customerRole.id } },
        customerProfile: { create: {} },
      },
    });
    const otp = await this.otp.issue('MOBILE', dto.mobile, 'VERIFY_MOBILE', { ip: meta.ip });
    const session = await this.session(user, meta);
    return { ...session, otp };
  }

  async login(email: string, password: string, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Compare against a dummy hash when the user doesn't exist so response time doesn't reveal accounts.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw new UnauthorizedException('Incorrect email or password');
    return this.session(user, meta);
  }

  private findByTarget(channel: OtpChannel, target: string) {
    return channel === 'MOBILE'
      ? this.prisma.user.findUnique({ where: { mobile: target } })
      : this.prisma.user.findUnique({ where: { email: target.toLowerCase() } });
  }

  async requestOtp(channel: OtpChannel, target: string, purpose: OtpPurpose, ip?: string) {
    const user = await this.findByTarget(channel, target);
    // Same response whether or not the account exists (no account enumeration).
    const result = await this.otp.issue(channel, target, purpose, { ip, deliver: !!user });
    return { message: 'If this account exists, a code has been sent.', ...result };
  }

  async verifyOtp(channel: OtpChannel, target: string, purpose: OtpPurpose, code: string, meta: SessionMeta) {
    await this.otp.verify(target, purpose, code);
    const user = await this.findByTarget(channel, target);
    if (!user) throw new BadRequestException('This code has expired. Please request a new one.');

    if (purpose === 'RESET_PASSWORD') {
      return { resetToken: await this.tokens.resetToken(user.id) };
    }
    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: channel === 'MOBILE' ? { mobileVerified: true } : { emailVerified: true },
    });
    return this.session(verified, meta);
  }

  async resetPassword(resetToken: string, newPassword: string) {
    const userId = this.tokens.verifyResetToken(resetToken);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) } });
    await this.tokens.revokeAll(userId);
    await this.audit.log({ actorId: userId, action: 'user.password_reset', entityType: 'User', entityId: userId });
    return { message: 'Password updated. Please log in with your new password.' };
  }

  async google(idToken: string, meta: SessionMeta) {
    const clientId = env().GOOGLE_CLIENT_ID;
    if (!clientId) throw new BadRequestException('Google login is not configured');
    this.googleClient ??= new OAuth2Client(clientId);
    const ticket = await this.googleClient.verifyIdToken({ idToken, audience: clientId }).catch(() => {
      throw new UnauthorizedException('Google sign-in failed. Please try again.');
    });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email || !p.email_verified) throw new UnauthorizedException('Google account email is not verified');

    let user = await this.prisma.user.findFirst({ where: { OR: [{ googleId: p.sub }, { email: p.email.toLowerCase() }] } });
    if (!user) {
      const customerRole = await this.prisma.role.findUniqueOrThrow({ where: { key: 'CUSTOMER' } });
      user = await this.prisma.user.create({
        data: {
          name: p.name ?? p.email.split('@')[0],
          email: p.email.toLowerCase(),
          googleId: p.sub,
          avatarUrl: p.picture,
          emailVerified: true,
          consentAt: new Date(),
          roles: { create: { roleId: customerRole.id } },
          customerProfile: { create: {} },
        },
      });
    } else if (!user.googleId) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { googleId: p.sub, emailVerified: true } });
    }
    return this.session(user, meta);
  }

  async refresh(raw: string, meta: SessionMeta) {
    const { userId, refreshToken, mfa } = await this.tokens.rotate(raw, meta);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { token, roles, permissions, twoFactorPending } = await this.tokens.accessToken(userId, mfa);
    return { accessToken: token, refreshToken, user: this.publicUser(user, roles, permissions, twoFactorPending) };
  }

  async me(userId: string, twoFactorPending: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const { roles, permissions } = await this.tokens.rolesAndPermissions(userId);
    return this.publicUser(user, roles, permissions, twoFactorPending && requiresTwoFactor(permissions));
  }
}
