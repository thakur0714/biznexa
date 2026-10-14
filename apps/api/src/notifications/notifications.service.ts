import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  DeviceTokenActionResponse,
  MarkAllReadResponse,
  NotificationItem,
  NotificationListPage,
  NotificationListQuery,
  NotificationUnreadCount,
  RegisterDeviceTokenInput,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the logged-in user's IN_APP notifications only, newest first,
   * supporting page and cursor paging.
   */
  async list(userId: string, query: NotificationListQuery): Promise<NotificationListPage> {
    const page = query.page ?? 1;
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const where = {
      userId,
      channel: 'IN_APP' as const,
    };

    const total = await this.prisma.notification.count({ where });

    let items;
    if (query.cursor) {
      const cursorExists = await this.prisma.notification.findFirst({
        where: { id: query.cursor, userId, channel: 'IN_APP' },
        select: { id: true },
      });
      if (!cursorExists) {
        throw new BadRequestException('Invalid pagination cursor');
      }
      items = await this.prisma.notification.findMany({
        where,
        take: limit,
        skip: 1,
        cursor: { id: query.cursor },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          event: true,
          title: true,
          body: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      });
    } else {
      items = await this.prisma.notification.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          event: true,
          title: true,
          body: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      });
    }

    const pages = Math.ceil(total / limit) || 1;
    const nextCursor = items.length === limit ? items[items.length - 1].id : null;

    return {
      items: items.map((i) => ({
        ...i,
        readAt: i.readAt ? i.readAt.toISOString() : null,
        createdAt: i.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      pages,
      nextCursor,
    };
  }

  /**
   * Uses existing (userId, readAt) index to count unread in-app notifications.
   */
  async unreadCount(userId: string): Promise<NotificationUnreadCount> {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        channel: 'IN_APP',
        readAt: null,
      },
    });
    return { count };
  }

  /**
   * Marks a single notification as read. Owner only, otherwise 404. Idempotent.
   */
  async markRead(id: string, userId: string): Promise<NotificationItem> {
    const row = await this.prisma.notification.findFirst({
      where: {
        id,
        userId,
        channel: 'IN_APP',
      },
    });

    if (!row) {
      throw new NotFoundException('Notification not found');
    }

    if (row.readAt) {
      return {
        id: row.id,
        event: row.event,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.readAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    }

    const updated = await this.prisma.notification.update({
      where: { id: row.id },
      data: { readAt: new Date() },
      select: {
        id: true,
        event: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
    });

    return {
      ...updated,
      readAt: (updated.readAt ?? new Date()).toISOString(),
      createdAt: updated.createdAt.toISOString(),
    };

  }

  /**
   * Sets readAt only on the user's unread in-app rows.
   */
  async markAllRead(userId: string): Promise<MarkAllReadResponse> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        channel: 'IN_APP',
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return { count: result.count };
  }

  /**
   * Registers a device token for push notifications. Owner only.
   */
  async registerDeviceToken(
    userId: string,
    input: RegisterDeviceTokenInput,
  ): Promise<DeviceTokenActionResponse> {
    const existing = await this.prisma.deviceToken.findUnique({
      where: { token: input.token },
    });

    if (existing && existing.userId !== userId) {
      throw new ForbiddenException('Device token belongs to another user');
    }

    await this.prisma.deviceToken.upsert({
      where: { token: input.token },
      create: {
        userId,
        token: input.token,
        platform: input.platform ?? null,
      },
      update: {
        userId,
        platform: input.platform ?? null,
        updatedAt: new Date(),
      },
    });

    return {
      success: true,
      token: input.token,
    };
  }

  /**
   * Unregisters a device token for push notifications. Owner only, else 403 or 404.
   */
  async unregisterDeviceToken(
    userId: string,
    token: string,
  ): Promise<DeviceTokenActionResponse> {
    const existing = await this.prisma.deviceToken.findUnique({
      where: { token },
    });

    if (!existing) {
      throw new NotFoundException('Device token not found');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('Forbidden: cannot unregister device token belonging to another user');
    }

    await this.prisma.deviceToken.delete({
      where: { token },
    });

    return {
      success: true,
      token,
    };
  }
}

