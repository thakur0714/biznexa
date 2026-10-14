import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';

import { SLA_DUE_SOON_HOURS, APPLICATION_STATUS_LABEL, PERMS, maskPan, type ApplicationTransitionInput, type AdminApplicationListQuery, type AdminApplicationPage, type BulkAssignInput, type AdminApplicationDetail, type ApplicationStatus } from '@biznexa/types';
import type { AuthUser } from '../common/auth.decorators';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApplicationStatusService } from './application-status.service';
import { EventBus } from '../events/event-bus';
import { applicationScope, findVisibleApplication } from './application-access';
import { decryptField } from '../common/encryption';

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
  service: { select: { id: true, name: true, stages: { select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } } } },
  package: { select: { name: true } },
  order: { select: { code: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.ApplicationSelect;

/** Staff applications list (M4.2). Scoping comes first; the filters can only narrow it. */
@Injectable()
export class AdminApplicationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly status: ApplicationStatusService, private readonly events: EventBus) {}

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

  
  async exportCSV(u: AuthUser, q: AdminApplicationListQuery): Promise<string> {
    const where: Prisma.ApplicationWhereInput = { AND: [applicationScope(u), ...(await this.filters(u, q, new Date()))] };
    const total = await this.prisma.application.count({ where });
    if (total > 10000) throw new BadRequestException('Cannot export more than 10,000 rows. Please narrow the filters.');

    const items = await this.prisma.application.findMany({
      where,
      orderBy: { [q.sort]: q.dir },
      select: {
        code: true,
        order: { select: { code: true, customer: { select: { name: true, email: true } } } },
        status: true,
        priority: true,
        service: { select: { name: true } },
        package: { select: { name: true } },
        assignedTo: { select: { name: true } },
        createdAt: true,
        slaDueAt: true,
      },
    });

    const escape = (v: string | null | undefined) => {
      if (!v) return '';
      const text = String(v).replace(/"/g, '""');
      if (/^[=+\-@]/.test(text)) return `"'${text}"`;
      return `"${text}"`;
    };
    
    const header = 'Application code,Order code,Status,Priority,Service,Package,Customer name,Customer email,Assigned to,Created,SLA due';
    const rows = items.map(r => {
      const customer = r.order?.customer;
      return [
        escape(r.code),
        escape(r.order?.code),
        escape(APPLICATION_STATUS_LABEL[r.status] || r.status),
        escape(r.priority),
        escape(r.service.name),
        escape(r.package.name),
        escape(customer?.name),
        escape(customer?.email),
        escape(r.assignedTo?.name),
        escape(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(r.createdAt).replace(',', '')),
        escape(r.slaDueAt ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(r.slaDueAt).replace(',', '') : ''),
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  async get(u: AuthUser, id: string): Promise<AdminApplicationDetail> {
    const app = await findVisibleApplication(this.prisma, u, id, {
      id: true,
      code: true,
      status: true,
      priority: true,
      slaDueAt: true,
      submittedAt: true,
      createdAt: true,
      updatedAt: true,
      formData: true,
      customerId: true,
      formSchemaVersion: true,
      
      service: { select: { id: true, name: true } },
      package: { select: { id: true, name: true } },
      
      businessEntity: { select: { id: true, pan: true } },
      
      order: {
        select: {
          id: true, code: true, status: true, total: true, taxTotal: true, subtotal: true,
          customer: { select: { id: true, name: true, email: true, mobile: true } }
        }
      },
      
      assignedTo: { select: { id: true, name: true } },
      currentStage: { select: { id: true, name: true } },
      
      documents: {
        where: { isLatest: true },
        select: {
          id: true, requirementId: true, name: true, status: true, fileKey: true, fileName: true, sizeBytes: true, mimeType: true
        },
        orderBy: { requirement: { sortOrder: 'asc' } },
        
      },
      
      history: {
        select: {
          id: true, status: true, stageId: true, visibleToCustomer: true, changedAt: true,
          changedBy: { select: { id: true, name: true } }
        },
        orderBy: { changedAt: 'desc' }
      }
    });

    const order = app.order;
    // Application has no customer relation; a draft may have no order yet.
    const customer = order?.customer ?? (await this.prisma.user.findUnique({ where: { id: app.customerId }, select: { id: true, name: true, email: true, mobile: true } }));
    
    
    let formSchema = null;
    if (app.formSchemaVersion) {
      const schemaRow = await this.prisma.serviceFormSchema.findUnique({
        where: { serviceId_version: { serviceId: app.service.id, version: app.formSchemaVersion } },
        select: { schema: true }
      });
      formSchema = schemaRow?.schema ?? null;
    }

    // Payments: get from order
    const payments = !order ? [] : await this.prisma.payment.findMany({
      where: { orderId: order.id },
      select: { id: true, status: true, amount: true, method: true, paidAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      id: app.id,
      code: app.code,
      status: app.status as any,
      priority: app.priority as any,
      slaDueAt: app.slaDueAt ? app.slaDueAt.toISOString() : null,
      submittedAt: app.submittedAt ? app.submittedAt.toISOString() : null,
      createdAt: app.createdAt.toISOString(),
      updatedAt: app.updatedAt.toISOString(),
      
      customer: customer ? {
        id: customer.id, name: customer.name, email: customer.email, mobile: customer.mobile
      } : null,
      
      service: { id: app.service.id, name: app.service.name },
      stages: (app.service as any).stages,
      package: { id: app.package.id, name: app.package.name },
      
      businessEntity: app.businessEntity ? {
        id: app.businessEntity.id,
        maskedPan: app.businessEntity.pan ? maskPan(decryptField(app.businessEntity.pan)) : null
      } : null,
      
      order: order ? {
        id: order.id, code: order.code, status: order.status,
        total: order.total, taxTotal: order.taxTotal, subtotal: order.subtotal
      } : null,
      
      payments: payments.map(p => ({
        id: p.id,
        status: p.status,
        amount: p.amount,
        method: p.method,
        paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      })),
      
      formSchema: formSchema as any,
      formData: app.formData as Record<string, unknown>,
      
      documents: app.documents.map(d => ({
        id: d.id,
        name: d.name,
        status: d.status,
        fileKey: d.fileKey || '',
        fileName: d.fileName || '',
        fileSize: d.sizeBytes || 0,
        mimeType: d.mimeType || '',
        requirementId: d.requirementId || '',
      })),
      
      history: app.history.map(h => ({
        id: h.id,
        status: h.status,
        stageId: h.stageId,
        visibleToCustomer: h.visibleToCustomer,
        changedBy: h.changedBy ? { id: h.changedBy?.id, name: h.changedBy?.name } : null,
        createdAt: h.changedAt.toISOString(),
      })),
      
      assignedTo: app.assignedTo ? { id: app.assignedTo.id, name: app.assignedTo.name } : null,
      currentStage: app.currentStage ? { id: app.currentStage.id, name: app.currentStage.name } : null,
    };
  }

  /** Active staff who may hold applications: their role grants applications.view_assigned or applications.view_all. */
  async getStaff() {
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        roles: { some: { role: { permissions: { some: { permission: { key: { in: [PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED] } } } } } } },
      },
      select: { id: true, name: true, roles: { select: { role: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({ id: u.id, name: u.name, role: u.roles.map((r) => r.role.name).join(', ') }));
  }

  async bulkAssign({ applicationIds, assigneeId }: BulkAssignInput, u: AuthUser) {
    if (assigneeId) {
      const eligible = await this.getStaff();
      if (!eligible.some(s => s.id === assigneeId)) {
        throw new BadRequestException('The selected user cannot be assigned applications');
      }
    }

    const events: any[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const id of applicationIds) {
        const event = await this.assignIn(tx, id, assigneeId, u);
        if (event) events.push(event);
      }
    });

    for (const e of events) {
      await this.events.emit('application.status_changed', e);
    }
  }

  async assign(id: string, assigneeId: string | null, u: AuthUser) {
    if (assigneeId) {
      const eligible = await this.getStaff();
      if (!eligible.some(s => s.id === assigneeId)) {
        throw new BadRequestException('The selected user cannot be assigned applications');
      }
    }

    let event: any = null;
    await this.prisma.$transaction(async (tx) => {
      event = await this.assignIn(tx, id, assigneeId, u);
    });

    if (event) {
      await this.events.emit('application.status_changed', event);
    }
  }

  private async assignIn(tx: Prisma.TransactionClient, id: string, assigneeId: string | null, u: AuthUser) {
    const app = await tx.application.findUnique({ 
      where: { id },
      include: { service: true } 
    });
    if (!app) throw new NotFoundException('Application not found');

    if (app.assignedToId === assigneeId) return null;

    let slaDueAt = app.slaDueAt;
    if (!app.assignedToId && assigneeId && !app.slaDueAt && app.service.estimatedDaysMax) {
      slaDueAt = new Date();
      slaDueAt.setDate(slaDueAt.getDate() + app.service.estimatedDaysMax);
    }

    let event = null;
    let finalStatus = app.status;
    if (app.status === 'DOCUMENTS_APPROVED' && assigneeId) {
      event = await this.status.transitionIn(tx, {
        applicationId: id,
        to: 'ASSIGNED',
        actorId: u.id,
      });
      finalStatus = 'ASSIGNED';
    }

    await tx.application.update({
      where: { id },
      data: { assignedToId: assigneeId, slaDueAt }
    });

    await this.audit.log({
      actorId: u.id,
      action: 'application.assign',
      entityType: 'Application',
      entityId: id,
      before: { assignedToId: app.assignedToId },
      after: { assignedToId: assigneeId }
    }, tx);

    return event;
  }

  async updateStatus(id: string, body: ApplicationTransitionInput, u: AuthUser) {
    await findVisibleApplication(this.prisma, u, id, { id: true });
    
    if (body.to === 'CANCELLED' && !u.permissions.includes(PERMS.APPLICATIONS_VIEW_ALL)) {
      throw new ForbiddenException('Only admins can cancel applications');
    }

    return this.status.transition({
      applicationId: id,
      to: body.to,
      actorId: u.id,
      note: body.note,
      visibleToCustomer: body.visibleToCustomer,
      stageId: body.stageId
    });
  }
}
