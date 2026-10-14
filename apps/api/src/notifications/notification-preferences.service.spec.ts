import { NotificationPreferencesService } from './notification-preferences.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new NotificationPreferencesService(mockPrisma as PrismaService);
  });

  it('returns default preferences when user has no notificationPrefs', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ notificationPrefs: null });

    const prefs = await service.getPreferences('user-1');
    expect(prefs).toEqual({
      marketingOptOut: false,
      channelPreferences: {},
    });
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { notificationPrefs: true },
    });
  });

  it('returns stored preferences when user has notificationPrefs', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      notificationPrefs: {
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

  it('updates preferences on User model', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      notificationPrefs: {
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

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        notificationPrefs: {
          marketingOptOut: true,
          channelPreferences: { EMAIL: true, SMS: false },
        },
      },
    });
  });
});
