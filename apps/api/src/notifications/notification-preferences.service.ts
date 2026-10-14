import { Injectable } from '@nestjs/common';
import {
  type UserNotificationPreferences,
  userNotificationPreferencesSchema,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(userId: string): Promise<UserNotificationPreferences> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });

    if (!user || !user.notificationPrefs || typeof user.notificationPrefs !== 'object') {
      return {
        marketingOptOut: false,
        channelPreferences: {},
      };
    }

    const parsed = userNotificationPreferencesSchema.safeParse(user.notificationPrefs);
    if (!parsed.success) {
      return {
        marketingOptOut: false,
        channelPreferences: {},
      };
    }

    return parsed.data;
  }

  async updatePreferences(
    userId: string,
    preferences: Partial<UserNotificationPreferences>,
  ): Promise<UserNotificationPreferences> {
    const current = await this.getPreferences(userId);
    const merged: UserNotificationPreferences = {
      marketingOptOut: preferences.marketingOptOut ?? current.marketingOptOut,
      channelPreferences: {
        ...current.channelPreferences,
        ...preferences.channelPreferences,
      },
    };

    const validated = userNotificationPreferencesSchema.parse(merged);

    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: validated as unknown as Prisma.InputJsonValue },
    });

    return validated;
  }
}
