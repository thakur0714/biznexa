import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AdminDataRequestList, AdminDataRequestListQuery, AdminDataRequestRow, RejectDataRequestInput } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { StorageService } from '../files/storage.service';
import type { Prisma } from '../generated/prisma/client';
import { anonymiseAccount, deletionBlockers, IN_PROGRESS_STATUSES } from './account-anonymiser';
import { toDataRequestResult } from './privacy.service';

const include = {
  user: { select: { id: true, name: true, email: true, mobile: true, deletedAt: true } },
  handledBy: { select: { id: true, name: true } },
} satisfies Prisma.DataRequestInclude;

/**
 * Staff side of DPDP requests (`privacy.manage`, M5.12): the queue, rejecting with a reason, and approving a
 * deletion, which anonymises the account in one transaction (D61). Every decision is audited.
 */
@Injectable()
export class AdminPrivacyService {
  private readonly log = new Logger('AdminPrivacy');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly storage: StorageService,
  ) {}

  /** Why this customer's account can't be deleted right now (empty = it can). */
  async blockers(userId: string, db: Prisma.TransactionClient = this.prisma, now = new Date()): Promise<string[]> {
    const [applicationsInProgress, ordersWithBalance, upcomingBookings] = await Promise.all([
      db.application.count({ where: { customerId: userId, status: { in: IN_PROGRESS_STATUSES } } }),
      // Only an advance-paid order has a balance due (as the dashboard counts it).
      db.order.count({ where: { customerId: userId, status: 'PARTIALLY_PAID' } }),
      db.booking.count({
        where: {
          customerId: userId,
          OR: [
            { status: 'CONFIRMED', endAt: { gt: now } },
            { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
          ],
        },
      }),
    ]);
    return deletionBlockers({ applicationsInProgress, ordersWithBalance, upcomingBookings });
  }

  async list(q: AdminDataRequestListQuery): Promise<AdminDataRequestList> {
    const where = { ...(q.type && { type: q.type }), ...(q.status && { status: q.status }) } satisfies Prisma.DataRequestWhereInput;
    const [rows, total] = await Promise.all([
      this.prisma.dataRequest.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.dataRequest.count({ where }),
    ]);
    const items = await Promise.all(rows.map(async (r) => this.toRow(r, r.type === 'DELETION' && r.status === 'PENDING' ? await this.blockers(r.userId) : [])));
    return { items, total, page: q.page, limit: q.limit };
  }

  /**
   * Approve a pending deletion. Under the request's row lock: still PENDING, no blockers (409 with the reasons),
   * then anonymise, complete the request and audit — all or nothing. File bytes are deleted after the commit.
   */
  async approve(id: string, actorId: string, now = new Date()): Promise<AdminDataRequestRow> {
    const { contact, fileKeys } = await this.prisma.$transaction(
      async (tx) => {
        const request = await this.lock(tx, id);
        if (request.type !== 'DELETION') throw new ConflictException('Data exports need no approval — they are prepared automatically');
        if (request.status !== 'PENDING') throw new ConflictException(`This request is already ${request.status.toLowerCase()}`);
        const blockers = await this.blockers(request.userId, tx, now);
        if (blockers.length) throw new ConflictException(`This account can't be deleted yet: ${blockers.join('; ')}.`);

        const contact = await tx.user.findUniqueOrThrow({ where: { id: request.userId }, select: { name: true, email: true, mobile: true } });
        const { fileKeys } = await anonymiseAccount(tx, request.userId, now);
        await tx.dataRequest.update({ where: { id }, data: { status: 'COMPLETED', handledById: actorId, handledAt: now, completedAt: now } });
        // No personal data in the audit trail: the user id is enough to find the request.
        await this.audit.log({ actorId, action: 'privacy.deletion_approve', entityType: 'DataRequest', entityId: id, after: { userId: request.userId, filesDeleted: fileKeys.length } }, tx);
        return { contact, fileKeys };
      },
      { timeout: 30_000 },
    );

    await Promise.all(fileKeys.map((key) => this.storage.remove(key).catch((e) => this.log.error(`Could not delete file ${key} of deleted account: ${e}`))));
    const row = await this.prisma.dataRequest.findUniqueOrThrow({ where: { id }, include });
    await this.events.emit('privacy.account_deleted', { requestId: id, userId: row.userId, ...contact });
    return this.toRow(row, []);
  }

  /** Turn down a pending request (either type) with a reason the customer sees. */
  async reject(id: string, input: RejectDataRequestInput, actorId: string, now = new Date()): Promise<AdminDataRequestRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      const request = await this.lock(tx, id);
      if (request.status !== 'PENDING') throw new ConflictException(`Only a pending request can be rejected; this one is ${request.status.toLowerCase()}`);
      const updated = await tx.dataRequest.update({
        where: { id },
        data: { status: 'REJECTED', rejectionReason: input.reason, handledById: actorId, handledAt: now },
        include,
      });
      await this.audit.log({ actorId, action: 'privacy.request_reject', entityType: 'DataRequest', entityId: id, before: { status: 'PENDING' }, after: { status: 'REJECTED', reason: input.reason } }, tx);
      return updated;
    });
    await this.events.emit('privacy.request_rejected', { requestId: id, userId: row.userId, type: row.type, reason: input.reason });
    return this.toRow(row, []);
  }

  private async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "DataRequest" WHERE id = ${id} FOR UPDATE`;
    const request = await tx.dataRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private toRow(r: Prisma.DataRequestGetPayload<{ include: typeof include }>, blockers: string[]): AdminDataRequestRow {
    const { downloadable: _d, ...base } = toDataRequestResult(r);
    return {
      ...base,
      user: { id: r.user.id, name: r.user.name, email: r.user.email, mobile: r.user.mobile, deleted: !!r.user.deletedAt },
      handledBy: r.handledBy,
      blockers,
    };
  }
}
