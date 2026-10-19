import { z } from 'zod';

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

/** Events supported for notifications from spec §7.9 (matching events.ts where applicable). */
export const NOTIFICATION_EVENTS = [
  'announcement.sent',
  'auth.registered',
  'auth.otp',
  'payment.succeeded',
  'payment.failed',
  'invoice.issued',
  'refund.processed',
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
  'message.received',
  'privacy.export_ready',
  'privacy.request_rejected',
  'privacy.account_deleted',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const announcementSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL_CUSTOMERS') }),
  z.object({ type: z.literal('ACTIVE_APPLICATION_CATEGORY'), categoryId: z.string().uuid() }),
  z.object({ type: z.literal('EXPIRING_CERTIFICATE'), days: z.number().int().min(1).max(365) }),
]);
export const announcementCountInputSchema = z.object({ segment: announcementSegmentSchema });
export const announcementSendInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  channels: z.array(z.enum(['IN_APP', 'EMAIL', 'PUSH', 'SMS'])).min(1).max(4).refine((items) => new Set(items).size === items.length, 'Channels must be unique'),
  segment: announcementSegmentSchema,
});
export const announcementCountSchema = z.object({ recipients: z.number().int().min(0) });
export const announcementSendResponseSchema = z.object({ sourceKey: z.string().uuid(), recipients: z.number().int().min(0), queued: z.number().int().min(0) });
export type AnnouncementSegment = z.infer<typeof announcementSegmentSchema>;
export type AnnouncementSendInput = z.infer<typeof announcementSendInputSchema>;
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
  /** The failure will not go away by trying again (no address, bad number, provider refused): not retried (M6.3). */
  permanent: z.boolean().optional(),
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

// ─────────────────────── Admin Template Editor (M6.9) ───────────────────────

export interface TemplateVariableInfo {
  name: string;
  description: string;
  sample: string;
}

export const NOTIFICATION_EVENT_VARIABLES: Record<NotificationEvent, TemplateVariableInfo[]> = {
  'announcement.sent': [],
  'auth.registered': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
  ],
  'auth.otp': [
    { name: 'otp', description: 'One-time verification code', sample: '482910' },
    { name: 'validMinutes', description: 'Validity duration in minutes', sample: '5' },
    { name: 'purpose', description: 'Purpose of verification', sample: 'login' },
  ],
  'payment.succeeded': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'orderId', description: 'Order code or ID', sample: 'ORD-2026-000123' },
    { name: 'orderCode', description: 'Formatted order reference code', sample: 'ORD-2026-000123' },
    { name: 'amount', description: 'Payment amount formatted in INR', sample: '₹4,999' },
    { name: 'link', description: 'Link to dashboard/orders', sample: 'https://biznexa.com/dashboard' },
  ],
  'payment.failed': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'orderId', description: 'Order code or ID', sample: 'ORD-2026-000123' },
    { name: 'orderCode', description: 'Formatted order reference code', sample: 'ORD-2026-000123' },
    { name: 'amount', description: 'Attempted payment amount formatted in INR', sample: '₹4,999' },
    { name: 'reason', description: 'Failure reason description', sample: 'Payment declined by bank' },
    { name: 'link', description: 'Link to retry payment', sample: 'https://biznexa.com/dashboard' },
  ],
  'invoice.issued': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'invoiceNumber', description: 'Tax invoice number', sample: 'INV-2026-000456' },
    { name: 'total', description: 'Total invoice amount formatted in INR', sample: '₹4,999' },
    { name: 'orderId', description: 'Related order code', sample: 'ORD-2026-000123' },
    { name: 'orderCode', description: 'Formatted order reference code', sample: 'ORD-2026-000123' },
    { name: 'link', description: 'Link to view/download invoice', sample: 'https://biznexa.com/dashboard/payments' },
  ],
  'refund.processed': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'orderId', description: 'Order code or ID', sample: 'ORD-2026-000123' },
    { name: 'orderCode', description: 'Formatted order reference code', sample: 'ORD-2026-000123' },
    { name: 'amount', description: 'Refunded amount formatted in INR', sample: '₹1,500' },
    { name: 'link', description: 'Link to dashboard payments', sample: 'https://biznexa.com/dashboard/payments' },
  ],
  'document.requested': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'documentName', description: 'Name of the requested document', sample: 'Electricity Bill' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'applicationCode', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'reason', description: 'Instructions or note for the requested document', sample: 'Address proof must be current' },
    { name: 'link', description: 'Direct upload link', sample: 'https://biznexa.com/dashboard' },
  ],
  'document.approved': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'documentName', description: 'Name of the approved document', sample: 'PAN Card' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'applicationCode', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'reason', description: 'Optional approval note', sample: '' },
    { name: 'link', description: 'Link to application details', sample: 'https://biznexa.com/dashboard' },
  ],
  'document.rejected': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'documentName', description: 'Name of the rejected document', sample: 'Address Proof' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'applicationCode', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'reason', description: 'Reason for rejection', sample: 'Document is blurry and unreadable' },
    { name: 'link', description: 'Link to re-upload document', sample: 'https://biznexa.com/dashboard' },
  ],
  'application.status_changed': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'applicationCode', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'status', description: 'Human-readable status label', sample: 'In Progress' },
    { name: 'reason', description: 'Status change note or reason', sample: 'Application filed with the MCA' },
    { name: 'link', description: 'Link to application timeline', sample: 'https://biznexa.com/dashboard' },
  ],
  'expert.assigned': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'expertName', description: 'Assigned specialist or manager', sample: 'Priya Verma' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'applicationCode', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'GST Registration' },
    { name: 'link', description: 'Link to application page', sample: 'https://biznexa.com/dashboard' },
  ],
  'consultation.booked': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'expertName', description: 'Consultant name', sample: 'CA Amit Gupta' },
    { name: 'date', description: 'Date of the consultation', sample: '25-Oct-2026' },
    { name: 'time', description: 'Time of the consultation (IST)', sample: '11:00 AM IST' },
    { name: 'meetingLink', description: 'Video meeting link', sample: 'https://meet.google.com/xyz-abc' },
    { name: 'link', description: 'Link to consultation details', sample: 'https://biznexa.com/dashboard/consultations' },
  ],
  'consultation.reminder': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'expertName', description: 'Consultant name', sample: 'CA Amit Gupta' },
    { name: 'minutesBefore', description: 'Minutes before meeting starts', sample: '15' },
    { name: 'meetingLink', description: 'Video meeting link', sample: 'https://meet.google.com/xyz-abc' },
    { name: 'link', description: 'Link to join consultation', sample: 'https://biznexa.com/dashboard/consultations' },
  ],
  'consultation.cancelled': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'expertName', description: 'Consultant name', sample: 'CA Amit Gupta' },
    { name: 'date', description: 'Scheduled date of cancelled consultation', sample: '25-Oct-2026' },
    { name: 'reason', description: 'Cancellation reason', sample: 'Consultant emergency' },
    { name: 'link', description: 'Link to reschedule consultation', sample: 'https://biznexa.com/consultants' },
  ],
  'certificate.issued': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'certificateNumber', description: 'Issued certificate number', sample: 'BN-ISO-2026-089' },
    { name: 'entityName', description: 'Legal name of the business entity', sample: 'Acme Technologies Pvt Ltd' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'applicationCode', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Associated service name', sample: 'ISO 9001 Certification' },
    { name: 'link', description: 'Link to view/download certificate', sample: 'https://biznexa.com/dashboard/certificates' },
  ],
  'certificate.expiring': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'certificateNumber', description: 'Expiring certificate number', sample: 'BN-ISO-2026-089' },
    { name: 'entityName', description: 'Legal name of the business entity', sample: 'Acme Technologies Pvt Ltd' },
    { name: 'daysLeft', description: 'Days remaining until expiry', sample: '30' },
    { name: 'link', description: 'Direct certificate view link', sample: 'https://biznexa.com/dashboard/certificates' },
  ],
  'compliance.reminder': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'complianceName', description: 'Compliance title / item', sample: 'Annual ROC Filing' },
    { name: 'entityName', description: 'Legal name of the business entity', sample: 'Acme Technologies Pvt Ltd' },
    { name: 'dueDate', description: 'Due date in DD-MMM-YYYY', sample: '30-Oct-2026' },
    { name: 'link', description: 'Link to dashboard reminders', sample: 'https://biznexa.com/dashboard' },
  ],
  'ticket.created': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'ticketCode', description: 'Support ticket reference code', sample: 'TKT-2026-000101' },
    { name: 'subject', description: 'Ticket subject line', sample: 'Clarification regarding DSC requirement' },
    { name: 'link', description: 'Link to view ticket conversation', sample: 'https://biznexa.com/dashboard/support' },
  ],
  'ticket.replied': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'ticketCode', description: 'Support ticket reference code', sample: 'TKT-2026-000101' },
    { name: 'replyExcerpt', description: 'Preview or excerpt of the reply message', sample: 'We have updated your DSC token status.' },
    { name: 'link', description: 'Link to reply back', sample: 'https://biznexa.com/dashboard/support' },
  ],
  'ticket.resolved': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'ticketCode', description: 'Support ticket reference code', sample: 'TKT-2026-000101' },
    { name: 'resolution', description: 'Resolution explanation', sample: 'Issue was resolved by updating the filing portal credentials.' },
    { name: 'link', description: 'Link to view resolved ticket', sample: 'https://biznexa.com/dashboard/support' },
  ],
  'message.received': [
    { name: 'recipientName', description: 'Name of message recipient', sample: 'Rajesh Sharma' },
    { name: 'applicationCode', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Associated service name', sample: 'Private Limited Company Registration' },
    { name: 'senderName', description: 'Name of the sender', sample: 'Priya Verma' },
    { name: 'messageExcerpt', description: 'Excerpt or snippet of message', sample: 'Please check the name approval options.' },
    { name: 'link', description: 'Link to application conversation', sample: 'https://biznexa.com/dashboard/applications/app-1' },
  ],
  'privacy.export_ready': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'expiresOn', description: 'Expiration date of the data export archive', sample: '25-Oct-2026' },
    { name: 'link', description: 'Link to privacy dashboard', sample: 'https://biznexa.com/dashboard/privacy' },
  ],
  'privacy.request_rejected': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'requestType', description: 'Type of privacy request', sample: 'data export' },
    { name: 'reason', description: 'Rejection reason', sample: 'Active ongoing applications require completion before deletion' },
    { name: 'link', description: 'Link to privacy dashboard', sample: 'https://biznexa.com/dashboard/privacy' },
  ],
  'privacy.account_deleted': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
  ],
};

export function extractTemplateVariables(templateStr: string): string[] {
  const variableRegex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  const used = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = variableRegex.exec(templateStr)) !== null) {
    used.add(match[1]);
  }
  return Array.from(used);
}

export function getSampleVariablesForEvent(event: string): Record<string, string> {
  const vars = NOTIFICATION_EVENT_VARIABLES[event as NotificationEvent];
  if (!vars) return {};
  return Object.fromEntries(vars.map((v) => [v.name, v.sample]));
}

export function getAllowedVariablesForEvent(event: string): string[] {
  const vars = NOTIFICATION_EVENT_VARIABLES[event as NotificationEvent];
  return vars ? vars.map((v) => v.name) : [];
}

export const updateNotificationTemplateInput = z.object({
  subject: z.string().trim().nullable().optional(),
  body: z.string().trim().min(1, 'Body is required'),
  dltTemplateId: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateNotificationTemplateInput = z.infer<typeof updateNotificationTemplateInput>;

export const adminNotificationTemplateSchema = z.object({
  id: z.string().uuid(),
  event: z.string(),
  channel: notificationChannelSchema,
  subject: z.string().nullable(),
  body: z.string(),
  dltTemplateId: z.string().nullable(),
  isActive: z.boolean(),
  updatedAt: z.string().datetime(),
  allowedVariables: z.array(z.string()),
});
export type AdminNotificationTemplate = z.infer<typeof adminNotificationTemplateSchema>;

export const adminNotificationTemplateListSchema = z.object({
  templates: z.array(adminNotificationTemplateSchema),
});
export type AdminNotificationTemplateList = z.infer<typeof adminNotificationTemplateListSchema>;

export const previewNotificationTemplateInput = z.object({
  channel: notificationChannelSchema,
  event: z.string().optional(),
  subject: z.string().nullable().optional(),
  body: z.string().min(1, 'Body is required'),
  sampleVariables: z.record(z.unknown()).optional(),
});
export type PreviewNotificationTemplateInput = z.infer<typeof previewNotificationTemplateInput>;

export const previewNotificationTemplateResponse = z.object({
  renderedSubject: z.string().optional(),
  renderedBody: z.string(),
  variablesUsed: z.array(z.string()),
  missingVariables: z.array(z.string()),
  unknownVariables: z.array(z.string()),
});
export type PreviewNotificationTemplateResponse = z.infer<typeof previewNotificationTemplateResponse>;

/**
 * Delivery log (M6.3, D59): one row per notification × channel. QUEUED until the job runs (also between
 * retries); SENT when the provider accepted it; DELIVERED when the provider confirmed delivery (or in-app);
 * FAILED after a permanent error or the last retry; SKIPPED when nothing was to be sent (opted out, no device).
 */
export const NOTIFICATION_DELIVERY_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];
export const notificationDeliveryStatusSchema = z.enum(NOTIFICATION_DELIVERY_STATUSES);

/** Filters for GET /api/admin/notifications/deliveries. `user` is a user id, or part of a name / email / mobile. */
export const notificationDeliveryFilterSchema = z.object({
  status: notificationDeliveryStatusSchema.optional(),
  channel: notificationChannelSchema.optional(),
  event: z.string().max(100).optional(),
  user: z.string().trim().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type NotificationDeliveryFilter = z.infer<typeof notificationDeliveryFilterSchema>;

/** A delivery log row as staff see it: no message content, no address. */
export const notificationDeliverySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  event: z.string(),
  channel: notificationChannelSchema,
  templateId: z.string().uuid().nullable(),
  status: notificationDeliveryStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  sendAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

export const notificationDeliveryPageSchema = z.object({
  items: z.array(notificationDeliverySchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  pages: z.number().int(),
});
export type NotificationDeliveryPage = z.infer<typeof notificationDeliveryPageSchema>;

