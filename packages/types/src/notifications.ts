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

// ─────────────────────── Admin Template Editor (M6.9) ───────────────────────

export interface TemplateVariableInfo {
  name: string;
  description: string;
  sample: string;
}

export const NOTIFICATION_EVENT_VARIABLES: Record<NotificationEvent, TemplateVariableInfo[]> = {
  'auth.registered': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
  ],
  'auth.otp': [
    { name: 'otp', description: 'One-time verification code', sample: '482910' },
    { name: 'validMinutes', description: 'Validity duration in minutes', sample: '10' },
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
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'link', description: 'Direct upload link', sample: 'https://biznexa.com/dashboard/documents' },
  ],
  'document.approved': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'documentName', description: 'Name of the approved document', sample: 'PAN Card' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'link', description: 'Link to application details', sample: 'https://biznexa.com/dashboard/applications/app-1' },
  ],
  'document.rejected': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'documentName', description: 'Name of the rejected document', sample: 'Address Proof' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'reason', description: 'Reason for rejection', sample: 'Document is blurry and unreadable' },
    { name: 'link', description: 'Link to re-upload document', sample: 'https://biznexa.com/dashboard/documents' },
  ],
  'application.status_changed': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'Private Limited Company Registration' },
    { name: 'status', description: 'Human-readable status label', sample: 'In Progress' },
    { name: 'stageName', description: 'Current process stage', sample: 'Name Approval' },
    { name: 'notes', description: 'Customer-visible update note', sample: 'Application filed with the MCA' },
    { name: 'link', description: 'Link to application timeline', sample: 'https://biznexa.com/dashboard/applications/app-1' },
  ],
  'expert.assigned': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'expertName', description: 'Assigned specialist or manager', sample: 'Priya Verma' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'serviceName', description: 'Service name', sample: 'GST Registration' },
    { name: 'link', description: 'Link to application page', sample: 'https://biznexa.com/dashboard/applications/app-1' },
  ],
  'consultation.booked': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'consultantName', description: 'Consultant name', sample: 'CA Amit Gupta' },
    { name: 'date', description: 'Date of the consultation', sample: '25-Oct-2026' },
    { name: 'time', description: 'Time of the consultation (IST)', sample: '11:00 AM IST' },
    { name: 'link', description: 'Link to consultation details', sample: 'https://biznexa.com/dashboard/consultations' },
  ],
  'consultation.reminder': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'consultantName', description: 'Consultant name', sample: 'CA Amit Gupta' },
    { name: 'date', description: 'Date of the consultation', sample: '25-Oct-2026' },
    { name: 'time', description: 'Time of the consultation (IST)', sample: '11:00 AM IST' },
    { name: 'link', description: 'Link to join consultation', sample: 'https://biznexa.com/dashboard/consultations' },
  ],
  'consultation.cancelled': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'consultantName', description: 'Consultant name', sample: 'CA Amit Gupta' },
    { name: 'date', description: 'Scheduled date of cancelled consultation', sample: '25-Oct-2026' },
    { name: 'reason', description: 'Cancellation reason', sample: 'Consultant emergency' },
    { name: 'link', description: 'Link to reschedule consultation', sample: 'https://biznexa.com/consultants' },
  ],
  'certificate.issued': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'certificateNumber', description: 'Issued certificate number', sample: 'BN-ISO-2026-089' },
    { name: 'serviceName', description: 'Associated service name', sample: 'ISO 9001 Certification' },
    { name: 'link', description: 'Link to view/download certificate', sample: 'https://biznexa.com/dashboard/certificates' },
  ],
  'certificate.expiring': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'certificateNumber', description: 'Expiring certificate number', sample: 'BN-ISO-2026-089' },
    { name: 'daysLeft', description: 'Days remaining until expiry', sample: '30' },
    { name: 'renewUrl', description: 'Renewal link', sample: 'https://biznexa.com/services/iso/iso-9001' },
    { name: 'link', description: 'Direct certificate view link', sample: 'https://biznexa.com/dashboard/certificates' },
  ],
  'compliance.reminder': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'title', description: 'Compliance title / item', sample: 'Annual ROC Filing' },
    { name: 'dueDate', description: 'Due date in DD-MMM-YYYY', sample: '30-Oct-2026' },
    { name: 'daysLeft', description: 'Days left until due date', sample: '15' },
    { name: 'renewUrl', description: 'Compliance renewal / service URL', sample: 'https://biznexa.com/services/compliance' },
    { name: 'link', description: 'Link to dashboard reminders', sample: 'https://biznexa.com/dashboard' },
  ],
  'ticket.created': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'ticketNumber', description: 'Support ticket number', sample: 'TKT-2026-000101' },
    { name: 'subject', description: 'Ticket subject line', sample: 'Clarification regarding DSC requirement' },
    { name: 'link', description: 'Link to view ticket conversation', sample: 'https://biznexa.com/dashboard/support/tkt-1' },
  ],
  'ticket.replied': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'ticketNumber', description: 'Support ticket number', sample: 'TKT-2026-000101' },
    { name: 'subject', description: 'Ticket subject line', sample: 'Clarification regarding DSC requirement' },
    { name: 'authorName', description: 'Name of the support respondent', sample: 'Support Team' },
    { name: 'messagePreview', description: 'Preview of the reply message', sample: 'We have updated your DSC token status.' },
    { name: 'link', description: 'Link to reply back', sample: 'https://biznexa.com/dashboard/support/tkt-1' },
  ],
  'ticket.resolved': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'ticketNumber', description: 'Support ticket number', sample: 'TKT-2026-000101' },
    { name: 'subject', description: 'Ticket subject line', sample: 'Clarification regarding DSC requirement' },
    { name: 'link', description: 'Link to view resolved ticket', sample: 'https://biznexa.com/dashboard/support/tkt-1' },
  ],
  'message.received': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'applicationNumber', description: 'Application reference code', sample: 'BN10025' },
    { name: 'senderName', description: 'Staff member name', sample: 'Priya Verma' },
    { name: 'preview', description: 'Preview snippet of message', sample: 'Please check the name approval options.' },
    { name: 'link', description: 'Link to application messages tab', sample: 'https://biznexa.com/dashboard/applications/app-1?tab=messages' },
  ],
  'privacy.export_ready': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'expiryDays', description: 'Days before export archive expires', sample: '7' },
    { name: 'downloadUrl', description: 'Download link for the zip file', sample: 'https://biznexa.com/dashboard/privacy' },
    { name: 'link', description: 'Link to privacy dashboard', sample: 'https://biznexa.com/dashboard/privacy' },
  ],
  'privacy.request_rejected': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
    { name: 'reason', description: 'Rejection reason', sample: 'Active ongoing applications require completion before deletion' },
    { name: 'link', description: 'Link to privacy dashboard', sample: 'https://biznexa.com/dashboard/privacy' },
  ],
  'privacy.account_deleted': [
    { name: 'customerName', description: 'Name of the customer', sample: 'Rajesh Sharma' },
  ],
};

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


