import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_CHANNELS,
  notificationChannelSchema,
  userNotificationPreferencesSchema,
  sendNotificationInputSchema,
} from './notifications';

describe('notification types and schemas', () => {
  it('validates notification channels', () => {
    expect(NOTIFICATION_CHANNELS).toEqual(['EMAIL', 'SMS', 'PUSH', 'IN_APP', 'WHATSAPP']);
    expect(notificationChannelSchema.safeParse('EMAIL').success).toBe(true);
    expect(notificationChannelSchema.safeParse('WHATSAPP').success).toBe(true);
    expect(notificationChannelSchema.safeParse('INVALID').success).toBe(false);
  });

  it('provides default preferences', () => {
    const parsed = userNotificationPreferencesSchema.parse({});
    expect(parsed.marketingOptOut).toBe(false);
    expect(parsed.channelPreferences).toEqual({});
  });

  it('validates user preferences with channel settings', () => {
    const parsed = userNotificationPreferencesSchema.parse({
      marketingOptOut: true,
      channelPreferences: { SMS: false, EMAIL: true },
    });
    expect(parsed.marketingOptOut).toBe(true);
    expect(parsed.channelPreferences?.SMS).toBe(false);
    expect(parsed.channelPreferences?.EMAIL).toBe(true);
  });

  it('validates sendNotificationInput with defaults', () => {
    const parsed = sendNotificationInputSchema.parse({
      userId: 'user-123',
      event: 'payment.success',
      channel: 'EMAIL',
      body: 'Your payment succeeded',
    });
    expect(parsed.category).toBe('TRANSACTIONAL');
    expect(parsed.channel).toBe('EMAIL');
  });

  it('rejects invalid channels in sendNotificationInput', () => {
    const res = sendNotificationInputSchema.safeParse({
      userId: 'user-123',
      event: 'payment.success',
      channel: 'CARRIER_PIGEON',
      body: 'Hi',
    });
    expect(res.success).toBe(false);
  });
});
