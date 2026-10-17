import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { CreateDataRequestInput, DataRequest as DataRequestResult, DataRequestList, PrivacyOtpResponse } from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';
import type { DataRequest, User } from '../generated/prisma/client';
import type { DataRequestStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OtpService } from '../auth/otp.service';
import { maskMobile } from '../notifications/providers/sms.provider';
import { DataExportService } from './data-export.service';

const OPEN = { in: ['PENDING', 'PROCESSING'] satisfies DataRequestStatus[] };

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '****';
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Where a deletion re-check code goes: the mobile if there is one, else the email. */
function otpTarget(user: Pick<User, 'mobile' | 'email'>) {
  if (user.mobile) return { channel: 'MOBILE' as const, target: user.mobile };
  if (user.email) return { channel: 'EMAIL' as const, target: user.email };
  return null;
}

export function toDataRequestResult(r: DataRequest, now = new Date()): DataRequestResult {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    reason: r.reason,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    handledAt: r.handledAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    downloadable: r.type === 'EXPORT' && r.status === 'COMPLETED' && !!r.fileKey && !!r.expiresAt && r.expiresAt > now,
  };
}

/**
 * The customer's side of DPDP requests (M5.12): "Download my data" and "Delete my account". One open request
 * per type (409; the partial unique index decides a race). A deletion is re-checked with the password or a
 * one-time code first.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly exports: DataExportService,
  ) {}

  private async customer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    return user;
  }

  async list(userId: string): Promise<DataRequestList> {
    const user = await this.customer(userId);
    const rows = await this.prisma.dataRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      items: rows.map((r) => toDataRequestResult(r)),
      reauth: { password: !!user.passwordHash, otpChannel: otpTarget(user)?.channel ?? null },
    };
  }

  /** Sends the deletion re-check code (same limits as login codes, D8). */
  async sendOtp(userId: string, ip?: string): Promise<PrivacyOtpResponse> {
    const user = await this.customer(userId);
    const to = otpTarget(user);
    if (!to) throw new BadRequestException('Your account has no mobile number or email to send a code to');
    const sent = await this.otp.issue(to.channel, to.target, 'ACCOUNT_DELETION', { ip });
    return { channel: to.channel, sentTo: to.channel === 'MOBILE' ? maskMobile(to.target) : maskEmail(to.target), ...sent };
  }

  async create(userId: string, input: CreateDataRequestInput): Promise<DataRequestResult> {
    const user = await this.customer(userId);
    if (input.type === 'DELETION') {
      if (user.roles.some((r) => r.role.key !== 'CUSTOMER')) {
        throw new ForbiddenException('Staff and consultant accounts cannot be deleted here. Please contact an administrator.');
      }
      await this.recheck(user, input);
    }

    const open = await this.prisma.dataRequest.findFirst({ where: { userId, type: input.type, status: OPEN } });
    if (open) throw new ConflictException(openMessage(input.type));

    const row = await this.prisma.dataRequest
      .create({ data: { userId, type: input.type, reason: input.reason || null } })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(openMessage(input.type));
        throw e;
      });
    await this.audit.log({ actorId: userId, action: 'privacy.request_create', entityType: 'DataRequest', entityId: row.id, after: { type: row.type } });
    // Exports need no review: the job starts at once. Deletions wait for staff (M5.12 step 3).
    if (row.type === 'EXPORT') this.exports.enqueue(row.id);
    return toDataRequestResult(row);
  }

  private async recheck(user: User, input: CreateDataRequestInput) {
    if (input.password) {
      const ok = user.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
      if (!ok) throw new BadRequestException('Incorrect password');
      return;
    }
    const to = otpTarget(user);
    if (!to || !input.otp) throw new BadRequestException('Enter your password or the code we sent you');
    await this.otp.verify(to.target, 'ACCOUNT_DELETION', input.otp);
  }

  /** The customer's own request, or 404 (another customer's request looks the same as none). */
  async own(userId: string, id: string) {
    const row = await this.prisma.dataRequest.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }
}

function openMessage(type: CreateDataRequestInput['type']) {
  return type === 'EXPORT'
    ? 'Your data export is already being prepared. We will notify you when it is ready.'
    : 'You have already asked to delete your account. Our team is reviewing it.';
}
