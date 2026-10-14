import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_CHANNELS,
  notificationChannelSchema,
  NOTIFICATION_EVENTS,
  notificationEventSchema,
  userNotificationPreferencesSchema,
  sendNotificationInputSchema,
  escapeHtml,
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

  it('validates notification events', () => {
    expect(NOTIFICATION_EVENTS).toHaveLength(19);
    expect(notificationEventSchema.safeParse('payment.succeeded').success).toBe(true);
    expect(notificationEventSchema.safeParse('auth.registered').success).toBe(true);
    expect(notificationEventSchema.safeParse('invalid.event').success).toBe(false);
  });

  it('validates sendNotificationInput with defaults', () => {
    const parsed = sendNotificationInputSchema.parse({
      userId: 'user-123',
      event: 'payment.succeeded',
      channel: 'EMAIL',
      body: 'Your payment succeeded',
    });
    expect(parsed.category).toBe('TRANSACTIONAL');
    expect(parsed.channel).toBe('EMAIL');
  });

  it('rejects invalid channels in sendNotificationInput', () => {
    const res = sendNotificationInputSchema.safeParse({
      userId: 'user-123',
      event: 'payment.succeeded',
      channel: 'CARRIER_PIGEON',
      body: 'Hi',
    });
    expect(res.success).toBe(false);
  });

  it('escapes HTML special characters correctly', () => {
    const input = `<script>alert("xss & 'hack'")</script>`;
    expect(escapeHtml(input)).toBe('&lt;script&gt;alert(&quot;xss &amp; &#39;hack&#39;&quot;)&lt;/script&gt;');
  });
});
