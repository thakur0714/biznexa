import { Injectable } from '@nestjs/common';
import {
  type UserNotificationPreferences,
  userNotificationPreferencesSchema,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

export const NOTIFICATION_PREFERENCE_PREFIX = 'notification.preferences.';

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  private preferenceKey(userId: string): string {
    return `${NOTIFICATION_PREFERENCE_PREFIX}${userId}`;
  }

  async getPreferences(userId: string): Promise<UserNotificationPreferences> {
    const key = this.preferenceKey(userId);
    const row = await this.prisma.setting.findUnique({
      where: { key },
      select: { value: true },
    });

    if (!row || !row.value || typeof row.value !== 'object') {
      return {
        marketingOptOut: false,
        channelPreferences: {},
      };
    }

    const parsed = userNotificationPreferencesSchema.safeParse(row.value);
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
    const key = this.preferenceKey(userId);

    await this.prisma.setting.upsert({
      where: { key },
      update: { value: validated as unknown as Prisma.InputJsonValue },
      create: { key, value: validated as unknown as Prisma.InputJsonValue },
    });

    return validated;
  }
}
