import { z } from 'zod';

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

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

/** Escapes HTML special characters in values for EMAIL and IN_APP channels. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
