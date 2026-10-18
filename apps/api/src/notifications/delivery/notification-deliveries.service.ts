import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationDelivery, NotificationDeliveryFilter, NotificationDeliveryPage } from '@biznexa/types';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const include = { user: { select: { name: true, email: true } } } satisfies Prisma.NotificationDeliveryInclude;
type Row = Prisma.NotificationDeliveryGetPayload<{ include: typeof include }>;

/** Delivery log for staff (M6.3): metadata only — never the message content or the address it went to. */
@Injectable()
export class NotificationDeliveriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: NotificationDeliveryFilter): Promise<NotificationDeliveryPage> {
    const where: Prisma.NotificationDeliveryWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.channel) where.channel = filter.channel;
    if (filter.event) where.event = filter.event;
    if (filter.user) {
      where.user = UUID.test(filter.user)
        ? { id: filter.user }
        : {
            OR: [
              { name: { contains: filter.user, mode: 'insensitive' } },
              { email: { contains: filter.user, mode: 'insensitive' } },
              { mobile: { contains: filter.user } },
            ],
          };
    }
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = new Date(filter.from);
      if (filter.to) where.createdAt.lte = new Date(filter.to);
    }

    const [total, rows] = await Promise.all([
      this.prisma.notificationDelivery.count({ where }),
      this.prisma.notificationDelivery.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
    ]);
    return { items: rows.map(toItem), total, page: filter.page, limit: filter.limit, pages: Math.ceil(total / filter.limit) };
  }

  async get(id: string): Promise<NotificationDelivery> {
    const row = await this.prisma.notificationDelivery.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException('Delivery not found');
    return toItem(row);
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toItem(r: Row): NotificationDelivery {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.user?.name ?? null,
    userEmail: r.user?.email ?? null,
    event: r.event,
    channel: r.channel,
    templateId: r.templateId,
    status: r.status,
    attempts: r.attempts,
    lastError: r.lastError,
    providerMessageId: r.providerMessageId,
    sendAt: iso(r.sendAt),
    sentAt: iso(r.sentAt),
    deliveredAt: iso(r.deliveredAt),
    failedAt: iso(r.failedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
