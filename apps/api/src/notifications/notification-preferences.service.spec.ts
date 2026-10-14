import { NotificationPreferencesService, NOTIFICATION_PREFERENCE_PREFIX } from './notification-preferences.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      setting: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new NotificationPreferencesService(mockPrisma as PrismaService);
  });

  it('returns default preferences when setting does not exist', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue(null);

    const prefs = await service.getPreferences('user-1');
    expect(prefs).toEqual({
      marketingOptOut: false,
      channelPreferences: {},
    });
    expect(mockPrisma.setting.findUnique).toHaveBeenCalledWith({
      where: { key: `${NOTIFICATION_PREFERENCE_PREFIX}user-1` },
      select: { value: true },
    });
  });

  it('returns stored preferences when setting exists', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      value: {
        marketingOptOut: true,
        channelPreferences: { SMS: false, EMAIL: true },
      },
    });

    const prefs = await service.getPreferences('user-1');
    expect(prefs).toEqual({
      marketingOptOut: true,
      channelPreferences: { SMS: false, EMAIL: true },
    });
  });

  it('updates preferences by merging and upserting setting', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      value: {
        marketingOptOut: false,
        channelPreferences: { EMAIL: true },
      },
    });

    const updated = await service.updatePreferences('user-1', {
      marketingOptOut: true,
      channelPreferences: { SMS: false },
    });

    expect(updated).toEqual({
      marketingOptOut: true,
      channelPreferences: { EMAIL: true, SMS: false },
    });

    expect(mockPrisma.setting.upsert).toHaveBeenCalledWith({
      where: { key: `${NOTIFICATION_PREFERENCE_PREFIX}user-1` },
      update: {
        value: {
          marketingOptOut: true,
          channelPreferences: { EMAIL: true, SMS: false },
        },
      },
      create: {
        key: `${NOTIFICATION_PREFERENCE_PREFIX}user-1`,
        value: {
          marketingOptOut: true,
          channelPreferences: { EMAIL: true, SMS: false },
        },
      },
    });
  });
});
