import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  MarkMessagesReadResponse,
  Message,
  MessageListQuery,
  MessageThreadPage,
  MessageUnreadCount,
  PostMessageInput,
} from '@biznexa/types';
import type { AuthUser } from '../common/auth.decorators';
import { EventBus } from '../events/event-bus';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findVisibleApplication } from './application-access';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  private async findCustomerApplication(
    db: Prisma.TransactionClient,
    customerId: string,
    applicationId: string,
  ): Promise<{ id: string; customerId: string }> {
    const app = await db.application.findFirst({
      where: { id: applicationId, customerId },
      select: { id: true, customerId: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  /**
   * The application's conversation, created on the first message. `skipDuplicates` (ON CONFLICT DO NOTHING)
   * keeps two first messages at once from failing on the unique applicationId, also inside a transaction.
   */
  private async ensureConversation(
    db: Prisma.TransactionClient,
    applicationId: string,
  ): Promise<{ id: string }> {
    await db.conversation.createMany({ data: [{ applicationId }], skipDuplicates: true });
    return db.conversation.findUniqueOrThrow({ where: { applicationId }, select: { id: true } });
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

  private async listThread(
    app: { id: string; customerId: string },
    q: MessageListQuery,
  ): Promise<MessageThreadPage> {
    // Reading never creates the conversation; no conversation yet = no messages.
    const where: Prisma.MessageWhereInput = { conversation: { applicationId: app.id } };

    // Page 1 is the newest messages (what a thread shows first); each page is returned oldest → newest.
    const [newestFirst, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { sender: { select: { id: true, name: true } } },
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      items: newestFirst.reverse().map((r) => this.toMessageDto(r, app.customerId)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async listStaff(
    applicationId: string,
    q: MessageListQuery,
    u: AuthUser,
  ): Promise<MessageThreadPage> {
    const app = await findVisibleApplication(this.prisma, u, applicationId, {
      id: true,
      customerId: true,
    });
    return this.listThread(app, q);
  }

  async listCustomer(
    applicationId: string,
    q: MessageListQuery,
    u: AuthUser,
  ): Promise<MessageThreadPage> {
    const app = await this.findCustomerApplication(this.prisma, u.id, applicationId);
    return this.listThread(app, q);
  }

  async postStaff(
    applicationId: string,
    input: PostMessageInput,
    u: AuthUser,
  ): Promise<Message> {
    const { msg, app } = await this.prisma.$transaction(async (tx) => {
      const visibleApp = await findVisibleApplication(tx, u, applicationId, {
        id: true,
        customerId: true,
      });
      const conv = await this.ensureConversation(tx, visibleApp.id);
      const created = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: u.id,
          body: input.body,
        },
        include: { sender: { select: { id: true, name: true } } },
      });
      return { msg: created, app: visibleApp };
    });

    await this.events.emit('message.created', {
      messageId: msg.id,
      applicationId: app.id,
      senderId: u.id,
      fromStaff: true,
    });

    return this.toMessageDto(msg, app.customerId);
  }

  async postCustomer(
    applicationId: string,
    input: PostMessageInput,
    u: AuthUser,
  ): Promise<Message> {
    const { msg, app } = await this.prisma.$transaction(async (tx) => {
      const ownedApp = await this.findCustomerApplication(tx, u.id, applicationId);
      const conv = await this.ensureConversation(tx, ownedApp.id);
      const created = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: u.id,
          body: input.body,
        },
        include: { sender: { select: { id: true, name: true } } },
      });
      return { msg: created, app: ownedApp };
    });

    await this.events.emit('message.created', {
      messageId: msg.id,
      applicationId: app.id,
      senderId: u.id,
      fromStaff: false,
    });

    return this.toMessageDto(msg, app.customerId);
  }

  async markReadStaff(
    applicationId: string,
    u: AuthUser,
  ): Promise<MarkMessagesReadResponse> {
    const app = await findVisibleApplication(this.prisma, u, applicationId, {
      id: true,
      customerId: true,
    });
    const { count } = await this.prisma.message.updateMany({
      where: {
        conversation: { applicationId: app.id },
        senderId: app.customerId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { count };
  }

  async markReadCustomer(
    applicationId: string,
    u: AuthUser,
  ): Promise<MarkMessagesReadResponse> {
    const app = await this.findCustomerApplication(this.prisma, u.id, applicationId);
    const { count } = await this.prisma.message.updateMany({
      where: {
        conversation: { applicationId: app.id },
        senderId: { not: app.customerId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { count };
  }

  async unreadCountStaff(
    applicationId: string,
    u: AuthUser,
  ): Promise<MessageUnreadCount> {
    const app = await findVisibleApplication(this.prisma, u, applicationId, {
      id: true,
      customerId: true,
    });
    const count = await this.prisma.message.count({
      where: {
        conversation: { applicationId: app.id },
        senderId: app.customerId,
        readAt: null,
      },
    });
    return { count };
  }

  async unreadCountCustomer(
    applicationId: string,
    u: AuthUser,
  ): Promise<MessageUnreadCount> {
    const app = await this.findCustomerApplication(this.prisma, u.id, applicationId);
    const count = await this.prisma.message.count({
      where: {
        conversation: { applicationId: app.id },
        senderId: { not: app.customerId },
        readAt: null,
      },
    });
    return { count };
  }
}
