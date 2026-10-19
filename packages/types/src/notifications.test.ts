import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_CHANNELS,
  notificationChannelSchema,
  NOTIFICATION_EVENTS,
  notificationEventSchema,
  userNotificationPreferencesSchema,
  sendNotificationInputSchema,
  escapeHtml,
  notificationItemSchema,
  notificationListQuerySchema,
  notificationUnreadCountSchema,
  markAllReadResponseSchema,
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
    expect(NOTIFICATION_EVENTS).toHaveLength(25);
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

  it('validates notificationItemSchema', () => {
    const valid = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      event: 'payment.succeeded',
      title: 'Payment Received',
      body: 'Your payment was successful.',
      link: '/dashboard/payments/1',
      readAt: '2026-10-14T10:00:00.000Z',
      createdAt: '2026-10-14T09:00:00.000Z',
    };
    expect(notificationItemSchema.safeParse(valid).success).toBe(true);

    const invalid = { ...valid, id: 'not-a-uuid' };
    expect(notificationItemSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates notificationListQuerySchema defaults and bounds', () => {
    const parsed = notificationListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);

    const clamped = notificationListQuerySchema.safeParse({ limit: 51 });
    expect(clamped.success).toBe(false);

    const validWithCursor = notificationListQuerySchema.parse({
      cursor: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      limit: 10,
    });
    expect(validWithCursor.cursor).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(validWithCursor.limit).toBe(10);
  });

  it('validates notificationUnreadCountSchema and markAllReadResponseSchema', () => {
    expect(notificationUnreadCountSchema.safeParse({ count: 5 }).success).toBe(true);
    expect(notificationUnreadCountSchema.safeParse({ count: -1 }).success).toBe(false);
    expect(markAllReadResponseSchema.safeParse({ count: 0 }).success).toBe(true);
  });
});
