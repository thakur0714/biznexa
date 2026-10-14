import { Injectable } from '@nestjs/common';
import { SLA_DUE_SOON_HOURS, type AdminApplicationListQuery, type AdminApplicationPage, type ApplicationStatus } from '@biznexa/types';
import type { AuthUser } from '../common/auth.decorators';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applicationScope } from './application-access';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const istDayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
/** Finished applications have no SLA left to miss. */
const CLOSED: ApplicationStatus[] = ['COMPLETED', 'DELIVERED', 'CANCELLED'];
/** At most this many customers matched by name/email/mobile are searched for (a broad term should be narrowed). */
const CUSTOMER_MATCH_LIMIT = 500;

const rowSelect = {
  id: true,
  code: true,
  status: true,
  priority: true,
  slaDueAt: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  customerId: true,
  service: { select: { id: true, name: true } },
  package: { select: { name: true } },
  order: { select: { code: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.ApplicationSelect;

/** Staff applications list (M4.2). Scoping comes first; the filters can only narrow it. */
@Injectable()
export class AdminApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, q: AdminApplicationListQuery, now = new Date()): Promise<AdminApplicationPage> {
    const where: Prisma.ApplicationWhereInput = { AND: [applicationScope(user), ...(await this.filters(user, q, now))] };
    const nullable = q.sort === 'slaDueAt' || q.sort === 'submittedAt';
    const orderBy: Prisma.ApplicationOrderByWithRelationInput[] = [
      nullable ? { [q.sort]: { sort: q.dir, nulls: 'last' } } : { [q.sort]: q.dir },
      { id: 'asc' }, // stable paging when the sort key ties
    ];

    const [rows, total] = await Promise.all([
      this.prisma.application.findMany({ where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit, select: rowSelect }),
      this.prisma.application.count({ where }),
    ]);
    // Application has no customer relation; one query for the page's customers.
    const customers = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } },
      select: { id: true, name: true, email: true, mobile: true },
    });
    const byId = new Map(customers.map((c) => [c.id, c]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        priority: r.priority,
        slaDueAt: r.slaDueAt?.toISOString() ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        service: r.service,
        packageName: r.package.name,
        orderCode: r.order?.code ?? null,
        customer: byId.get(r.customerId) ?? null,
        assignedTo: r.assignedTo,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  private async filters(user: AuthUser, q: AdminApplicationListQuery, now: Date): Promise<Prisma.ApplicationWhereInput[]> {
    const and: Prisma.ApplicationWhereInput[] = [];
    and.push(q.status ? { status: { in: q.status } } : { status: { not: 'DRAFT' } });
    if (q.serviceId) and.push({ serviceId: q.serviceId });
    if (q.assignee) and.push({ assignedToId: q.assignee === 'me' ? user.id : q.assignee === 'unassigned' ? null : q.assignee });
    if (q.priority) and.push({ priority: q.priority });
    if (q.sla === 'overdue') and.push({ slaDueAt: { lt: now }, status: { notIn: CLOSED } });
    if (q.sla === 'due_soon') and.push({ slaDueAt: { gte: now, lt: new Date(now.getTime() + SLA_DUE_SOON_HOURS * HOUR_MS) }, status: { notIn: CLOSED } });
    if (q.from || q.to) {
      and.push({
        createdAt: {
          ...(q.from ? { gte: istDayStart(q.from) } : {}),
          ...(q.to ? { lt: new Date(istDayStart(q.to).getTime() + DAY_MS) } : {}),
        },
      });
    }
    if (q.q) {
      const term = q.q;
      const customers = await this.prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term.toLowerCase() } },
            { mobile: { contains: term.replace(/\D/g, '') || term } },
          ],
        },
        select: { id: true },
        take: CUSTOMER_MATCH_LIMIT,
      });
      and.push({
        OR: [
          { code: { contains: term.toUpperCase() } },
          { order: { code: { contains: term.toUpperCase() } } },
          ...(customers.length ? [{ customerId: { in: customers.map((c) => c.id) } }] : []),
        ],
      });
    }
    return and;
  }
}
