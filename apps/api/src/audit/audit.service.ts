import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { AuditLogFilter, AuditLogPage } from '@biznexa/types';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

/** Append-only record of staff actions (who, what, when, before/after). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass `db` to write the entry inside the caller's transaction. */
  async log(entry: AuditEntry, db: Prisma.TransactionClient = this.prisma) {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: (entry.before ?? undefined) as object | undefined,
        after: (entry.after ?? undefined) as object | undefined,
        ip: entry.ip,
      },
    });
  }


  /** Recursive redaction for secrets */
  private redactSecrets(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map((v) => this.redactSecrets(v));
    }
    const redacted = { ...obj } as Record<string, unknown>;
    for (const key of Object.keys(redacted)) {
      const lower = key.toLowerCase();
      if (
        lower === 'password' || lower === 'passwordhash' || 
        lower === 'totpsecret' || lower === 'twofactorsecret' || 
        lower === 'secret' || lower === 'token' || 
        lower === 'accesstoken' || lower === 'refreshtoken' || 
        lower === 'pan'
      ) {
        redacted[key] = '***';
      } else {
        redacted[key] = this.redactSecrets(redacted[key]);
      }
    }
    return redacted;
  }

  async list(filter: AuditLogFilter): Promise<AuditLogPage> {
    const where: Prisma.AuditLogWhereInput = {};
    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.action) where.action = filter.action;
    
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = new Date(filter.from);
      if (filter.to) where.createdAt.lte = new Date(filter.to);
    }

    const total = await this.prisma.auditLog.count({ where });
    const pages = Math.ceil(total / filter.limit);
    const offset = (filter.page - 1) * filter.limit;

    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: filter.limit,
      include: {
        actor: {
          select: { name: true, email: true },
        },
      },
    });

    return {
      total,
      page: filter.page,
      limit: filter.limit,
      pages,
      items: items.map(item => ({
        id: item.id,
        actorId: item.actorId,
        actorName: item.actor?.name ?? null,
        actorEmail: item.actor?.email ?? null,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        before: this.redactSecrets(item.before) as Record<string, unknown> | null,
        after: this.redactSecrets(item.after) as Record<string, unknown> | null,
        ip: item.ip,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

}


