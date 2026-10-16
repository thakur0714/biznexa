import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  type AdminTicketDetail,
  type AdminTicketListPage,
  type AdminTicketListQuery,
  type AdminTicketSummary,
  type CreateTicketInput,
  type CustomerTicketListPage,
  type CustomerTicketListQuery,
  type Message,
  type MessageThreadPage,
  PERMS,
  type PostTicketMessageInput,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
  type UpdateTicketInput,
  canTransition,
} from '@biznexa/types';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  private async getNextTicketCode(tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `TKT-${year}-`;
    const [row] = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING("code" FROM ${'^' + prefix + '([0-9]{1,9})$'}) AS INTEGER)) AS max
      FROM "Ticket" WHERE "code" LIKE ${prefix + '%'}`;
    const currentMax = row?.max ?? 0;
    return `${prefix}${String(currentMax + 1).padStart(6, '0')}`;
  }

  private async ensureConversation(
    tx: Prisma.TransactionClient | PrismaService,
    ticketId: string,
  ): Promise<{ id: string }> {
    const existing = await tx.conversation.findFirst({
      where: { ticketId },
      select: { id: true },
    });
    if (existing) return existing;
    return tx.conversation.create({
      data: { ticketId },
      select: { id: true },
    });
  }

  private toMessageDto(
    m: {
      id: string;
      body: string | null;
      senderId: string;
      createdAt: Date;
      readAt: Date | null;
      sender: { id: string; name: string };
    },
    customerId: string,
  ): Message {
    return {
      id: m.id,
      body: m.body ?? '',
      sender: {
        id: m.sender.id,
        name: m.sender.name,
        isStaff: m.senderId !== customerId,
      },
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
    };
  }

  private async getThread(
    db: Prisma.TransactionClient | PrismaService,
    ticketId: string,
    customerId: string,
    limit = 50,
  ): Promise<MessageThreadPage> {
    const conv = await this.ensureConversation(db, ticketId);
    const where: Prisma.MessageWhereInput = { conversationId: conv.id };
    const [messagesDesc, total] = await Promise.all([
      db.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { sender: { select: { id: true, name: true } } },
      }),
      db.message.count({ where }),
    ]);

    const items = messagesDesc.reverse().map((m) => this.toMessageDto(m, customerId));
    return {
      items,
      total,
      page: 1,
      limit,
    };
  }

  private toSummaryDto(t: {
    id: string;
    code: string;
    subject: string;
    description: string;
    priority: TicketPriority;
    status: TicketStatus;
    applicationId: string | null;
    application?: { id: string; code: string; service: { name: string } } | null;
    assignedToId?: string | null;
    assignedTo?: { id: string; name: string } | null;
    firstResponseAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): TicketSummary {
    return {
      id: t.id,
      code: t.code,
      subject: t.subject,
      description: t.description,
      priority: t.priority,
      status: t.status,
      applicationId: t.applicationId,
      applicationCode: t.application?.code ?? null,
      applicationService: t.application?.service?.name ?? null,
      assignedToId: t.assignedToId ?? (t.assignedTo ? t.assignedTo.id : null),
      assignedTo: t.assignedTo ? { id: t.assignedTo.id, name: t.assignedTo.name } : null,
      firstResponseAt: t.firstResponseAt ? t.firstResponseAt.toISOString() : null,
      resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toAdminSummaryDto(t: {
    id: string;
    code: string;
    customerId: string;
    customer: { id: string; name: string; email: string | null; mobile: string | null };
    subject: string;
    description: string;
    priority: TicketPriority;
    status: TicketStatus;
    applicationId: string | null;
    application?: { id: string; code: string; service: { name: string } } | null;
    assignedToId?: string | null;
    assignedTo?: { id: string; name: string } | null;
    firstResponseAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): AdminTicketSummary {
    return {
      ...this.toSummaryDto(t),
      customerId: t.customerId,
      customer: {
        id: t.customer.id,
        name: t.customer.name,
        email: t.customer.email,
        mobile: t.customer.mobile ?? null,
      },
    };
  }

  // ─────────────── Customer Operations ───────────────

  async createCustomerTicket(customerId: string, input: CreateTicketInput): Promise<TicketSummary> {
    if (input.applicationId) {
      const app = await this.prisma.application.findFirst({
        where: { id: input.applicationId, customerId },
        select: { id: true },
      });
      if (!app) {
        throw new NotFoundException('Application not found');
      }
    }

    let attempts = 0;
    while (attempts < 10) {
      try {
        const ticket = await this.prisma.$transaction(async (tx) => {
          const code = await this.getNextTicketCode(tx);
          const t = await tx.ticket.create({
            data: {
              code,
              customerId,
              applicationId: input.applicationId ?? null,
              subject: input.subject,
              description: input.description,
              priority: input.priority,
              status: 'OPEN',
              conversations: {
                create: {},
              },
            },
            include: {
              application: { select: { id: true, code: true, service: { select: { name: true } } } },
              assignedTo: { select: { id: true, name: true } },
              conversations: { select: { id: true } },
            },
          });
          return t;
        });

        await this.events.emit('ticket.created', {
          ticketId: ticket.id,
          ticketCode: ticket.code,
          customerId,
          subject: ticket.subject,
        });

        return this.toSummaryDto(ticket);
      } catch (e: unknown) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempts < 9) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25) + 5));
          continue;
        }
        throw e;
      }
    }

    throw new ConflictException('Failed to generate a unique ticket code. Please try again.');
  }

  async listCustomer(customerId: string, q: CustomerTicketListQuery): Promise<CustomerTicketListPage> {
    const where: Prisma.TicketWhereInput = {
      customerId,
      ...(q.status ? { status: q.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          application: { select: { id: true, code: true, service: { select: { name: true } } } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toSummaryDto(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async getCustomerTicket(customerId: string, id: string): Promise<TicketDetail> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, customerId },
      include: {
        application: { select: { id: true, code: true, service: { select: { name: true } } } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const thread = await this.getThread(this.prisma, ticket.id, customerId);
    return {
      ...this.toSummaryDto(ticket),
      thread,
      messages: thread.items,
    };
  }

  async postCustomerMessage(customerId: string, id: string, input: PostTicketMessageInput): Promise<Message> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, customerId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status === 'CLOSED') {
      throw new ConflictException('Ticket is closed');
    }

    const { msg, updatedTicket } = await this.prisma.$transaction(async (tx) => {
      let t = ticket;
      // The customer answered: back to the team (RESOLVED → reopened, WAITING_FOR_CUSTOMER → their turn again).
      if (ticket.status === 'RESOLVED' || ticket.status === 'WAITING_FOR_CUSTOMER') {
        t = await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: 'IN_PROGRESS', resolvedAt: null },
        });
      }

      const conv = await this.ensureConversation(tx, ticket.id);
      const createdMsg = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: customerId,
          body: input.body,
        },
        include: { sender: { select: { id: true, name: true } } },
      });

      return { msg: createdMsg, updatedTicket: t };
    });

    const excerpt = input.body.length > 120 ? input.body.slice(0, 120) + '...' : input.body;
    await this.events.emit('ticket.replied', {
      ticketId: updatedTicket.id,
      ticketCode: updatedTicket.code,
      customerId,
      messageId: msg.id,
      senderId: customerId,
      fromStaff: false,
      replyExcerpt: excerpt,
    });

    return this.toMessageDto(msg, customerId);
  }

  // ─────────────── Staff Operations ───────────────

  async listStaff(q: AdminTicketListQuery): Promise<AdminTicketListPage> {
    const where: Prisma.TicketWhereInput = {};

    if (q.status) {
      where.status = q.status;
    }
    if (q.priority) {
      where.priority = q.priority;
    }
    if (q.assignee) {
      if (q.assignee === 'unassigned') {
        where.assignedToId = null;
      } else {
        where.assignedToId = q.assignee;
      }
    }
    if (q.q) {
      where.OR = [
        { code: { contains: q.q, mode: 'insensitive' } },
        { subject: { contains: q.q, mode: 'insensitive' } },
        { customer: { name: { contains: q.q, mode: 'insensitive' } } },
        { customer: { email: { contains: q.q, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          customer: { select: { id: true, name: true, email: true, mobile: true } },
          application: { select: { id: true, code: true, service: { select: { name: true } } } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toAdminSummaryDto(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async getStaffTicket(id: string): Promise<AdminTicketDetail> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true, mobile: true } },
        application: { select: { id: true, code: true, service: { select: { name: true } } } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const thread = await this.getThread(this.prisma, ticket.id, ticket.customerId);
    return {
      ...this.toAdminSummaryDto(ticket),
      thread,
      messages: thread.items,
    };
  }

  async updateStatus(id: string, newStatus: TicketStatus, staffId: string): Promise<AdminTicketSummary> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (!canTransition('ticket', ticket.status, newStatus)) {
      throw new ConflictException(`Invalid ticket status change: ${ticket.status} → ${newStatus}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.TicketUpdateInput = {
        status: newStatus,
        ...(newStatus === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
      };

      const t = await tx.ticket.update({
        where: { id: ticket.id },
        data: updateData,
        include: {
          customer: { select: { id: true, name: true, email: true, mobile: true } },
          application: { select: { id: true, code: true, service: { select: { name: true } } } },
          assignedTo: { select: { id: true, name: true } },
        },
      });

      await this.audit.log(
        {
          actorId: staffId,
          action: 'ticket.status',
          entityType: 'Ticket',
          entityId: ticket.id,
          before: { status: ticket.status },
          after: { status: newStatus },
        },
        tx,
      );

      return t;
    });

    if (newStatus === 'RESOLVED') {
      await this.events.emit('ticket.resolved', {
        ticketId: updated.id,
        ticketCode: updated.code,
        customerId: updated.customerId,
      });
    }

    return this.toAdminSummaryDto(updated);
  }

  async updateAssignee(id: string, assignedToId: string | null, staffId: string): Promise<AdminTicketSummary> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (assignedToId) {
      const staffUser = await this.prisma.user.findFirst({
        where: {
          id: assignedToId,
          status: 'ACTIVE',
          deletedAt: null,
          roles: { some: { role: { permissions: { some: { permission: { key: PERMS.TICKETS_MANAGE } } } } } },
        },
      });
      if (!staffUser) {
        throw new BadRequestException('Selected assignee is not eligible for tickets');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.update({
        where: { id: ticket.id },
        data: { assignedToId },
        include: {
          customer: { select: { id: true, name: true, email: true, mobile: true } },
          application: { select: { id: true, code: true, service: { select: { name: true } } } },
          assignedTo: { select: { id: true, name: true } },
        },
      });

      await this.audit.log(
        {
          actorId: staffId,
          action: 'ticket.assign',
          entityType: 'Ticket',
          entityId: ticket.id,
          before: { assignedToId: ticket.assignedToId },
          after: { assignedToId },
        },
        tx,
      );

      return t;
    });

    return this.toAdminSummaryDto(updated);
  }

  async updatePriority(id: string, priority: TicketPriority, staffId: string): Promise<AdminTicketSummary> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.update({
        where: { id: ticket.id },
        data: { priority },
        include: {
          customer: { select: { id: true, name: true, email: true, mobile: true } },
          application: { select: { id: true, code: true, service: { select: { name: true } } } },
          assignedTo: { select: { id: true, name: true } },
        },
      });

      await this.audit.log(
        {
          actorId: staffId,
          action: 'ticket.priority',
          entityType: 'Ticket',
          entityId: ticket.id,
          before: { priority: ticket.priority },
          after: { priority },
        },
        tx,
      );

      return t;
    });

    return this.toAdminSummaryDto(updated);
  }

  async updateTicket(id: string, input: UpdateTicketInput, staffId: string): Promise<AdminTicketSummary> {
    if (input.status) {
      await this.updateStatus(id, input.status, staffId);
    }
    if (input.priority) {
      await this.updatePriority(id, input.priority, staffId);
    }
    if (input.assignedToId !== undefined) {
      await this.updateAssignee(id, input.assignedToId, staffId);
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true, mobile: true } },
        application: { select: { id: true, code: true, service: { select: { name: true } } } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.toAdminSummaryDto(ticket);
  }

  async postStaffReply(id: string, input: PostTicketMessageInput, staffId: string): Promise<Message> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status === 'CLOSED') {
      throw new ConflictException('Ticket is closed');
    }

    const { msg, updatedTicket } = await this.prisma.$transaction(async (tx) => {
      const conv = await this.ensureConversation(tx, ticket.id);
      const createdMsg = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: staffId,
          body: input.body,
        },
        include: { sender: { select: { id: true, name: true } } },
      });

      const updateData: Prisma.TicketUpdateInput = {
        status: 'WAITING_FOR_CUSTOMER',
      };
      if (!ticket.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }

      const t = await tx.ticket.update({
        where: { id: ticket.id },
        data: updateData,
      });

      await this.audit.log(
        {
          actorId: staffId,
          action: 'ticket.reply',
          entityType: 'Ticket',
          entityId: ticket.id,
          after: { messageId: createdMsg.id, status: 'WAITING_FOR_CUSTOMER' },
        },
        tx,
      );

      return { msg: createdMsg, updatedTicket: t };
    });

    const excerpt = input.body.length > 120 ? input.body.slice(0, 120) + '...' : input.body;
    await this.events.emit('ticket.replied', {
      ticketId: updatedTicket.id,
      ticketCode: updatedTicket.code,
      customerId: updatedTicket.customerId,
      messageId: msg.id,
      senderId: staffId,
      fromStaff: true,
      replyExcerpt: excerpt,
    });

    return this.toMessageDto(msg, updatedTicket.customerId);
  }

  async getStaff() {
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        roles: { some: { role: { permissions: { some: { permission: { key: PERMS.TICKETS_MANAGE } } } } } },
      },
      select: { id: true, name: true, roles: { select: { role: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({ id: u.id, name: u.name, role: u.roles.map((r) => r.role.name).join(', ') }));
  }

  @Cron('10 0 * * *', { timeZone: 'Asia/Kolkata' })
  async closeResolvedTickets(now: Date = new Date()): Promise<number> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const resolvedTickets = await this.prisma.ticket.findMany({
      where: {
        status: 'RESOLVED',
        OR: [
          { resolvedAt: { lte: sevenDaysAgo } },
          { resolvedAt: null, updatedAt: { lte: sevenDaysAgo } },
        ],
      },
      select: { id: true, status: true },
    });

    let closedCount = 0;
    for (const t of resolvedTickets) {
      const res = await this.prisma.ticket.updateMany({
        where: { id: t.id, status: 'RESOLVED' },
        data: { status: 'CLOSED' },
      });
      if (res.count > 0) {
        closedCount++;
      }
    }

    if (closedCount > 0) {
      this.logger.log(`Auto-closed ${closedCount} resolved ticket(s) older than 7 days`);
    }
    return closedCount;
  }
}
