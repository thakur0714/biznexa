import { z } from 'zod';

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

/** Events supported for notifications from spec §7.9 (matching events.ts where applicable). */
export const NOTIFICATION_EVENTS = [
  'auth.registered',
  'auth.otp',
  'payment.succeeded',
  'payment.failed',
  'invoice.issued',
  'document.requested',
  'document.approved',
  'document.rejected',
  'application.status_changed',
  'expert.assigned',
  'consultation.booked',
  'consultation.reminder',
  'consultation.cancelled',
  'certificate.issued',
  'certificate.expiring',
  'compliance.reminder',
  'ticket.created',
  'ticket.replied',
  'ticket.resolved',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const notificationEventSchema = z.enum(NOTIFICATION_EVENTS);

export const NOTIFICATION_CATEGORIES = ['TRANSACTIONAL', 'MARKETING'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);

export const userNotificationPreferencesSchema = z.object({
  /** Marketing messages are suppressed when true. Transactional messages are never suppressed. */
  marketingOptOut: z.boolean().default(false),
  /** Optional channel-level preferences (for marketing/non-essential messages). */
  channelPreferences: z
    .record(notificationChannelSchema, z.boolean())
    .optional()
    .default({}),
});
export type UserNotificationPreferences = z.input<typeof userNotificationPreferencesSchema>;
export type UserNotificationPreferencesData = z.output<typeof userNotificationPreferencesSchema>;

export const notificationRecipientSchema = z.object({
  email: z.string().email().optional(),
  mobile: z.string().optional(),
  pushToken: z.string().optional(),
});
export type NotificationRecipient = z.infer<typeof notificationRecipientSchema>;

export const sendNotificationInputSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  event: z.string().min(1, 'event is required'),
  channel: notificationChannelSchema,
  category: notificationCategorySchema.default('TRANSACTIONAL'),
  title: z.string().optional(),
  body: z.string().min(1, 'body is required'),
  link: z.string().nullable().optional(),
  payload: z.record(z.unknown()).nullable().optional(),
  recipient: notificationRecipientSchema.optional(),
});
export type SendNotificationInput = z.input<typeof sendNotificationInputSchema>;
export type SendNotificationData = z.output<typeof sendNotificationInputSchema>;

export const notificationResultSchema = z.object({
  success: z.boolean(),
  channel: notificationChannelSchema,
  notificationId: z.string().optional(),
  skipped: z.boolean().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
});
export type NotificationResult = z.infer<typeof notificationResultSchema>;

export const notificationTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  event: z.string().min(1, 'event is required'),
  channel: notificationChannelSchema,
  subject: z.string().nullable().optional(),
  body: z.string().min(1, 'body is required'),
  dltTemplateId: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});
export type NotificationTemplateInput = z.input<typeof notificationTemplateSchema>;
export type NotificationTemplateData = z.output<typeof notificationTemplateSchema>;

export interface RenderedNotification {
  subject?: string;
  body: string;
}

/** Escapes HTML special characters in values for EMAIL channel. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** In-app notification item representation (M6.7). */
export const notificationItemSchema = z.object({
  id: z.string().uuid(),
  event: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** Paging and filter options for GET /api/notifications. */
export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/** Page response for GET /api/notifications. */
export const notificationListPageSchema = z.object({
  items: z.array(notificationItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  pages: z.number().int(),
  nextCursor: z.string().uuid().nullable().optional(),
});
export type NotificationListPage = z.infer<typeof notificationListPageSchema>;

/** Response for GET /api/notifications/unread-count. */
export const notificationUnreadCountSchema = z.object({
  count: z.number().int().min(0),
});
export type NotificationUnreadCount = z.infer<typeof notificationUnreadCountSchema>;

/** Response for POST /api/notifications/read-all. */
export const markAllReadResponseSchema = z.object({
  count: z.number().int().min(0),
});
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

export const registerDeviceTokenInputSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});
export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenInputSchema>;

export const unregisterDeviceTokenInputSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});
export type UnregisterDeviceTokenInput = z.infer<typeof unregisterDeviceTokenInputSchema>;

export const deviceTokenSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  token: z.string(),
  platform: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DeviceToken = z.infer<typeof deviceTokenSchema>;

export const deviceTokenActionResponseSchema = z.object({
  success: z.boolean(),
  token: z.string().optional(),
});
export type DeviceTokenActionResponse = z.infer<typeof deviceTokenActionResponseSchema>;

