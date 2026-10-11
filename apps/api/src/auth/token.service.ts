import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requiresTwoFactor } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../config/env';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * Short-lived JWT access tokens + rotating opaque refresh tokens.
 * Refresh tokens are stored hashed. Re-using a rotated token revokes the whole family
 * (a sign the token was stolen).
 *
 * Staff 2FA (D27): a staff session that has not passed the 2FA check gets an access token with **no
 * permissions** and `tfa: 'pending'`; the refresh token records `mfaAt` once it has, and keeps it on rotation.
 */
@Injectable()
export class TokenService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async rolesAndPermissions(userId: string) {
    const roles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const roleKeys = roles.map((r) => r.role.key);
    const perms = new Set<string>();
    for (const r of roles) for (const rp of r.role.permissions) perms.add(rp.permission.key);
    return { roles: roleKeys, permissions: [...perms] };
  }

  /** `permissions` is the full list (for the UI); the token only carries them once 2FA is done. */
  async accessToken(userId: string, mfa = false) {
    const { roles, permissions } = await this.rolesAndPermissions(userId);
    const required = requiresTwoFactor(permissions);
    const pending = required && !mfa;
    const token = await this.jwt.signAsync({
      sub: userId,
      roles,
      perms: pending ? [] : permissions,
      ...(required ? { tfa: pending ? 'pending' : 'ok' } : {}),
      typ: 'access',
    });
    return { token, roles, permissions, twoFactorPending: pending };
  }

  async createRefresh(userId: string, meta: SessionMeta, family: string = randomUUID(), mfaAt: Date | null = null) {
    const raw = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        family,
        tokenHash: sha256(raw),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + env().REFRESH_TTL_DAYS * 86400_000),
        mfaAt,
      },
    });
    return raw;
  }

  /** Validates and rotates a refresh token; returns the user id, the replacement token and whether 2FA was passed. */
  async rotate(raw: string, meta: SessionMeta) {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!record) throw new UnauthorizedException('Please log in again');
    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { family: record.family, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Please log in again');
    }
    if (record.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Session expired. Please log in again.');

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');

    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    const next = await this.createRefresh(record.userId, meta, record.family, record.mfaAt);
    return { userId: record.userId, refreshToken: next, mfa: !!record.mfaAt };
  }

  async revoke(raw: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAll(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** One-time token allowing a password change after an OTP check. */
  resetToken(userId: string) {
    return this.jwt.signAsync({ sub: userId, typ: 'reset' }, { expiresIn: '10m' });
  }

  verifyResetToken(token: string): string {
    try {
      const p = this.jwt.verify(token);
      if (p.typ !== 'reset') throw new Error();
      return p.sub;
    } catch {
      throw new UnauthorizedException('This reset link has expired. Please start again.');
    }
  }
}
