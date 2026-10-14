import type { PrismaClient, NotificationChannel } from '../src/generated/prisma/client';

export interface SeedTemplate {
  event: string;
  channel: NotificationChannel;
  subject?: string;
  body: string;
  dltTemplateId?: string;
}

/**
 * Seed templates for all events listed in PROMPT §7.9:
 * registration, OTP, payment success/failure, invoice issued, document requested,
 * document approved, document rejected, application status change, expert assigned,
 * consultation booked/reminder/cancelled, certificate issued, certificate expiring,
 * compliance reminder, ticket created/replied/resolved.
 */
export const SEED_NOTIFICATION_TEMPLATES: SeedTemplate[] = [
  // ────────────────── Registration ──────────────────
  {
    event: 'registration',
    channel: 'EMAIL',
    subject: 'Welcome to BizNexa, {{customerName}}!',
    body: '<p>Hello {{customerName}},</p><p>Welcome to BizNexa! Your account has been registered successfully. Explore our full suite of business registration, compliance, tax, and intellectual property services.</p>',
  },
  {
    event: 'registration',
    channel: 'SMS',
    body: 'Hello {{customerName}}, welcome to BizNexa! Your account is active. Manage all your business services at biznexa.com.',
  },
  {
    event: 'registration',
    channel: 'PUSH',
    subject: 'Welcome to BizNexa',
    body: 'Hello {{customerName}}, your account is now ready.',
  },
  {
    event: 'registration',
    channel: 'IN_APP',
    subject: 'Welcome to BizNexa',
    body: 'Hello {{customerName}}, welcome to BizNexa! Start exploring our compliance and registration services.',
  },
  {
    event: 'registration',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, welcome to BizNexa! Your account has been created successfully.',
  },
  // Alias auth.registered
  {
    event: 'auth.registered',
    channel: 'EMAIL',
    subject: 'Welcome to BizNexa, {{customerName}}!',
    body: '<p>Hello {{customerName}},</p><p>Welcome to BizNexa! Your account has been registered successfully.</p>',
  },
  {
    event: 'auth.registered',
    channel: 'IN_APP',
    subject: 'Welcome to BizNexa',
    body: 'Hello {{customerName}}, your account has been registered successfully.',
  },

  // ────────────────── OTP ──────────────────
  {
    event: 'otp',
    channel: 'EMAIL',
    subject: 'Your BizNexa Verification Code: {{otp}}',
    body: '<p>Hello,</p><p>Your verification code is <strong>{{otp}}</strong>. It is valid for {{validMinutes}} minutes. Do not share this code with anyone.</p>',
  },
  {
    event: 'otp',
    channel: 'SMS',
    body: '{{otp}} is your BizNexa verification code. Valid for {{validMinutes}} minutes. Do not share this code.',
    dltTemplateId: '1107161234567890101',
  },
  {
    event: 'otp',
    channel: 'PUSH',
    subject: 'Verification Code',
    body: 'Your BizNexa verification code is {{otp}}.',
  },
  {
    event: 'otp',
    channel: 'IN_APP',
    subject: 'Verification Code',
    body: 'Your verification code is {{otp}} (valid for {{validMinutes}} minutes).',
  },
  {
    event: 'otp',
    channel: 'WHATSAPP',
    body: 'Your BizNexa verification code is {{otp}}. Valid for {{validMinutes}} minutes.',
  },
  // Alias auth.otp
  {
    event: 'auth.otp',
    channel: 'SMS',
    body: '{{otp}} is your BizNexa verification code. Valid for {{validMinutes}} minutes.',
    dltTemplateId: '1107161234567890101',
  },
  {
    event: 'auth.otp',
    channel: 'EMAIL',
    subject: 'Your BizNexa Verification Code: {{otp}}',
    body: '<p>Your verification code is <strong>{{otp}}</strong> (valid for {{validMinutes}} minutes).</p>',
  },

  // ────────────────── Payment Success ──────────────────
  {
    event: 'payment.success',
    channel: 'EMAIL',
    subject: 'Payment Successful for Order #{{orderId}}',
    body: '<p>Hello {{customerName}},</p><p>We received your payment of Rs. {{amount}} for Order #{{orderId}}.</p>',
  },
  {
    event: 'payment.success',
    channel: 'SMS',
    body: 'Payment of Rs. {{amount}} received for Order {{orderId}}. Thank you for choosing BizNexa.',
  },
  {
    event: 'payment.success',
    channel: 'PUSH',
    subject: 'Payment Received',
    body: 'Payment of Rs. {{amount}} for Order {{orderId}} was successful.',
  },
  {
    event: 'payment.success',
    channel: 'IN_APP',
    subject: 'Payment Successful',
    body: 'Your payment of Rs. {{amount}} for Order {{orderId}} was successful.',
  },
  {
    event: 'payment.success',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your payment of Rs. {{amount}} for Order {{orderId}} has been processed.',
  },
  // Alias payment.succeeded
  {
    event: 'payment.succeeded',
    channel: 'EMAIL',
    subject: 'Payment Successful for Order #{{orderId}}',
    body: '<p>Hello {{customerName}},</p><p>We received your payment of Rs. {{amount}} for Order #{{orderId}}.</p>',
  },
  {
    event: 'payment.succeeded',
    channel: 'IN_APP',
    subject: 'Payment Successful',
    body: 'Your payment of Rs. {{amount}} for Order {{orderId}} was successful.',
  },

  // ────────────────── Payment Failure ──────────────────
  {
    event: 'payment.failure',
    channel: 'EMAIL',
    subject: 'Payment Failed for Order #{{orderId}}',
    body: '<p>Hello {{customerName}},</p><p>Your payment attempt of Rs. {{amount}} for Order #{{orderId}} could not be completed. Reason: {{reason}}.</p>',
  },
  {
    event: 'payment.failure',
    channel: 'SMS',
    body: 'Payment of Rs. {{amount}} for Order {{orderId}} failed: {{reason}}. Please retry on BizNexa.',
  },
  {
    event: 'payment.failure',
    channel: 'PUSH',
    subject: 'Payment Failed',
    body: 'Payment for Order {{orderId}} failed. Tap to retry.',
  },
  {
    event: 'payment.failure',
    channel: 'IN_APP',
    subject: 'Payment Failed',
    body: 'Payment of Rs. {{amount}} for Order {{orderId}} failed: {{reason}}.',
  },
  {
    event: 'payment.failure',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, payment for Order {{orderId}} was unsuccessful: {{reason}}.',
  },
  // Alias payment.failed
  {
    event: 'payment.failed',
    channel: 'EMAIL',
    subject: 'Payment Failed for Order #{{orderId}}',
    body: '<p>Hello {{customerName}},</p><p>Payment for Order {{orderId}} could not be completed: {{reason}}.</p>',
  },
  {
    event: 'payment.failed',
    channel: 'IN_APP',
    subject: 'Payment Failed',
    body: 'Payment of Rs. {{amount}} for Order {{orderId}} failed: {{reason}}.',
  },

  // ────────────────── Invoice Issued ──────────────────
  {
    event: 'invoice.issued',
    channel: 'EMAIL',
    subject: 'Tax Invoice #{{invoiceNumber}} Issued',
    body: '<p>Hello {{customerName}},</p><p>Your tax invoice <strong>#{{invoiceNumber}}</strong> for Rs. {{total}} has been issued.</p>',
  },
  {
    event: 'invoice.issued',
    channel: 'SMS',
    body: 'Tax Invoice {{invoiceNumber}} of Rs. {{total}} is ready for your BizNexa order.',
  },
  {
    event: 'invoice.issued',
    channel: 'PUSH',
    subject: 'Invoice Ready',
    body: 'Tax Invoice {{invoiceNumber}} is now available for download.',
  },
  {
    event: 'invoice.issued',
    channel: 'IN_APP',
    subject: 'Invoice Issued',
    body: 'Tax Invoice #{{invoiceNumber}} for Rs. {{total}} is ready in your account.',
  },
  {
    event: 'invoice.issued',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your invoice {{invoiceNumber}} for Rs. {{total}} is now available.',
  },

  // ────────────────── Document Requested ──────────────────
  {
    event: 'document.requested',
    channel: 'EMAIL',
    subject: 'Action Required: Document Requested for Application {{applicationNumber}}',
    body: '<p>Hello {{customerName}},</p><p>Please upload <strong>{{documentName}}</strong> for application {{applicationNumber}} ({{serviceName}}).</p>',
  },
  {
    event: 'document.requested',
    channel: 'SMS',
    body: 'Please upload {{documentName}} for application {{applicationNumber}} on BizNexa.',
  },
  {
    event: 'document.requested',
    channel: 'PUSH',
    subject: 'Document Requested',
    body: 'Please upload {{documentName}} for application {{applicationNumber}}.',
  },
  {
    event: 'document.requested',
    channel: 'IN_APP',
    subject: 'Document Requested',
    body: 'Please upload {{documentName}} for application {{applicationNumber}} ({{serviceName}}).',
  },
  {
    event: 'document.requested',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, please upload {{documentName}} for application {{applicationNumber}} on BizNexa.',
  },

  // ────────────────── Document Approved ──────────────────
  {
    event: 'document.approved',
    channel: 'EMAIL',
    subject: 'Document Approved for Application {{applicationNumber}}',
    body: '<p>Hello {{customerName}},</p><p>Your document <strong>{{documentName}}</strong> for application {{applicationNumber}} has been verified and approved.</p>',
  },
  {
    event: 'document.approved',
    channel: 'SMS',
    body: 'Document {{documentName}} for application {{applicationNumber}} has been approved.',
  },
  {
    event: 'document.approved',
    channel: 'PUSH',
    subject: 'Document Approved',
    body: '{{documentName}} for application {{applicationNumber}} has been approved.',
  },
  {
    event: 'document.approved',
    channel: 'IN_APP',
    subject: 'Document Approved',
    body: 'Document {{documentName}} for application {{applicationNumber}} was verified and approved.',
  },
  {
    event: 'document.approved',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, {{documentName}} for application {{applicationNumber}} has been approved.',
  },

  // ────────────────── Document Rejected ──────────────────
  {
    event: 'document.rejected',
    channel: 'EMAIL',
    subject: 'Action Required: Document Rejected for Application {{applicationNumber}}',
    body: '<p>Hello {{customerName}},</p><p>Your document <strong>{{documentName}}</strong> for application {{applicationNumber}} was rejected. Reason: {{reason}}. Please upload a revised document.</p>',
  },
  {
    event: 'document.rejected',
    channel: 'SMS',
    body: 'Document {{documentName}} for application {{applicationNumber}} rejected: {{reason}}. Please re-upload.',
  },
  {
    event: 'document.rejected',
    channel: 'PUSH',
    subject: 'Document Rejected',
    body: 'Document {{documentName}} was rejected. Tap to view reason and re-upload.',
  },
  {
    event: 'document.rejected',
    channel: 'IN_APP',
    subject: 'Document Rejected',
    body: 'Document {{documentName}} was rejected: {{reason}}. Please upload a revised document.',
  },
  {
    event: 'document.rejected',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, document {{documentName}} was rejected: {{reason}}. Please re-upload on BizNexa.',
  },

  // ────────────────── Application Status Change ──────────────────
  {
    event: 'application.status_changed',
    channel: 'EMAIL',
    subject: 'Status Update: Application {{applicationNumber}} is now {{status}}',
    body: '<p>Hello {{customerName}},</p><p>Your application {{applicationNumber}} for <strong>{{serviceName}}</strong> has updated to: <strong>{{status}}</strong>.</p>',
  },
  {
    event: 'application.status_changed',
    channel: 'SMS',
    body: 'Application {{applicationNumber}} ({{serviceName}}) is now {{status}}. Check your dashboard on BizNexa.',
  },
  {
    event: 'application.status_changed',
    channel: 'PUSH',
    subject: 'Application Status Updated',
    body: 'Application {{applicationNumber}} is now {{status}}.',
  },
  {
    event: 'application.status_changed',
    channel: 'IN_APP',
    subject: 'Application Status Updated',
    body: 'Application {{applicationNumber}} for {{serviceName}} is now {{status}}.',
  },
  {
    event: 'application.status_changed',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your application {{applicationNumber}} for {{serviceName}} is now {{status}}.',
  },

  // ────────────────── Expert Assigned ──────────────────
  {
    event: 'expert.assigned',
    channel: 'EMAIL',
    subject: 'Expert Assigned for Application {{applicationNumber}}',
    body: '<p>Hello {{customerName}},</p><p><strong>{{expertName}}</strong> has been assigned to handle your application {{applicationNumber}} ({{serviceName}}).</p>',
  },
  {
    event: 'expert.assigned',
    channel: 'SMS',
    body: 'Expert {{expertName}} has been assigned to your BizNexa application {{applicationNumber}}.',
  },
  {
    event: 'expert.assigned',
    channel: 'PUSH',
    subject: 'Expert Assigned',
    body: '{{expertName}} has been assigned to your application {{applicationNumber}}.',
  },
  {
    event: 'expert.assigned',
    channel: 'IN_APP',
    subject: 'Expert Assigned',
    body: '{{expertName}} has been assigned as your expert for application {{applicationNumber}}.',
  },
  {
    event: 'expert.assigned',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, {{expertName}} has been assigned to your application {{applicationNumber}}.',
  },

  // ────────────────── Consultation Booked ──────────────────
  {
    event: 'consultation.booked',
    channel: 'EMAIL',
    subject: 'Consultation Confirmed with {{expertName}}',
    body: '<p>Hello {{customerName}},</p><p>Your consultation with {{expertName}} is confirmed for {{date}} at {{time}}. Meeting link: {{meetingLink}}.</p>',
  },
  {
    event: 'consultation.booked',
    channel: 'SMS',
    body: 'Consultation confirmed with {{expertName}} on {{date}} at {{time}}. Meeting link: {{meetingLink}}.',
  },
  {
    event: 'consultation.booked',
    channel: 'PUSH',
    subject: 'Consultation Confirmed',
    body: 'Your meeting with {{expertName}} is scheduled for {{date}} at {{time}}.',
  },
  {
    event: 'consultation.booked',
    channel: 'IN_APP',
    subject: 'Consultation Confirmed',
    body: 'Your consultation with {{expertName}} is confirmed for {{date}} at {{time}}.',
  },
  {
    event: 'consultation.booked',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your consultation with {{expertName}} is confirmed for {{date}} at {{time}}. Link: {{meetingLink}}.',
  },

  // ────────────────── Consultation Reminder ──────────────────
  {
    event: 'consultation.reminder',
    channel: 'EMAIL',
    subject: 'Reminder: Consultation with {{expertName}} Starts in {{minutesBefore}} Minutes',
    body: '<p>Hello {{customerName}},</p><p>Your consultation with {{expertName}} starts in {{minutesBefore}} minutes. Meeting link: {{meetingLink}}.</p>',
  },
  {
    event: 'consultation.reminder',
    channel: 'SMS',
    body: 'Reminder: Consultation with {{expertName}} starts in {{minutesBefore}} mins. Join: {{meetingLink}}.',
  },
  {
    event: 'consultation.reminder',
    channel: 'PUSH',
    subject: 'Meeting Starting Soon',
    body: 'Your consultation with {{expertName}} starts in {{minutesBefore}} minutes.',
  },
  {
    event: 'consultation.reminder',
    channel: 'IN_APP',
    subject: 'Consultation Starting Soon',
    body: 'Your consultation with {{expertName}} starts in {{minutesBefore}} minutes. Meeting link: {{meetingLink}}.',
  },
  {
    event: 'consultation.reminder',
    channel: 'WHATSAPP',
    body: 'Reminder: Consultation with {{expertName}} starts in {{minutesBefore}} minutes. Join: {{meetingLink}}.',
  },

  // ────────────────── Consultation Cancelled ──────────────────
  {
    event: 'consultation.cancelled',
    channel: 'EMAIL',
    subject: 'Consultation Cancelled',
    body: '<p>Hello {{customerName}},</p><p>Your consultation scheduled with {{expertName}} on {{date}} has been cancelled. Reason: {{reason}}.</p>',
  },
  {
    event: 'consultation.cancelled',
    channel: 'SMS',
    body: 'Consultation with {{expertName}} on {{date}} was cancelled. Please check BizNexa.',
  },
  {
    event: 'consultation.cancelled',
    channel: 'PUSH',
    subject: 'Consultation Cancelled',
    body: 'Your consultation scheduled for {{date}} has been cancelled.',
  },
  {
    event: 'consultation.cancelled',
    channel: 'IN_APP',
    subject: 'Consultation Cancelled',
    body: 'Your consultation scheduled for {{date}} has been cancelled: {{reason}}.',
  },
  {
    event: 'consultation.cancelled',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your consultation on {{date}} has been cancelled.',
  },

  // ────────────────── Certificate Issued ──────────────────
  {
    event: 'certificate.issued',
    channel: 'EMAIL',
    subject: 'Certificate Issued: {{certificateNumber}}',
    body: '<p>Hello {{customerName}},</p><p>Congratulations! Your certificate <strong>{{certificateNumber}}</strong> for {{entityName}} has been issued and is available in your account.</p>',
  },
  {
    event: 'certificate.issued',
    channel: 'SMS',
    body: 'Certificate {{certificateNumber}} issued for {{entityName}}. Download from your BizNexa dashboard.',
  },
  {
    event: 'certificate.issued',
    channel: 'PUSH',
    subject: 'Certificate Issued',
    body: 'Certificate {{certificateNumber}} for {{entityName}} is ready to download.',
  },
  {
    event: 'certificate.issued',
    channel: 'IN_APP',
    subject: 'Certificate Issued',
    body: 'Certificate {{certificateNumber}} for {{entityName}} has been issued.',
  },
  {
    event: 'certificate.issued',
    channel: 'WHATSAPP',
    body: 'Congratulations {{customerName}}! Your certificate {{certificateNumber}} has been issued.',
  },

  // ────────────────── Certificate Expiring ──────────────────
  {
    event: 'certificate.expiring',
    channel: 'EMAIL',
    subject: 'Urgent: Certificate {{certificateNumber}} Expiring in {{daysLeft}} Days',
    body: '<p>Hello {{customerName}},</p><p>Your certificate <strong>{{certificateNumber}}</strong> for {{entityName}} will expire in {{daysLeft}} days. Please renew now to maintain compliance.</p>',
  },
  {
    event: 'certificate.expiring',
    channel: 'SMS',
    body: 'Certificate {{certificateNumber}} expires in {{daysLeft}} days. Renew now on BizNexa.',
  },
  {
    event: 'certificate.expiring',
    channel: 'PUSH',
    subject: 'Certificate Expiring Soon',
    body: 'Certificate {{certificateNumber}} expires in {{daysLeft}} days. Tap to renew.',
  },
  {
    event: 'certificate.expiring',
    channel: 'IN_APP',
    subject: 'Certificate Expiring Soon',
    body: 'Certificate {{certificateNumber}} for {{entityName}} expires in {{daysLeft}} days. Click Renew Now.',
  },
  {
    event: 'certificate.expiring',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your certificate {{certificateNumber}} expires in {{daysLeft}} days. Renew on BizNexa.',
  },

  // ────────────────── Compliance Reminder ──────────────────
  {
    event: 'compliance.reminder',
    channel: 'EMAIL',
    subject: 'Compliance Reminder: {{complianceName}} Due on {{dueDate}}',
    body: '<p>Hello {{customerName}},</p><p>Reminder for {{entityName}}: <strong>{{complianceName}}</strong> is due on {{dueDate}}. File in advance to avoid late filing penalties.</p>',
  },
  {
    event: 'compliance.reminder',
    channel: 'SMS',
    body: 'Compliance {{complianceName}} for {{entityName}} is due on {{dueDate}}. File on BizNexa today.',
  },
  {
    event: 'compliance.reminder',
    channel: 'PUSH',
    subject: 'Compliance Due Soon',
    body: '{{complianceName}} for {{entityName}} is due on {{dueDate}}.',
  },
  {
    event: 'compliance.reminder',
    channel: 'IN_APP',
    subject: 'Compliance Due Soon',
    body: '{{complianceName}} for {{entityName}} is due on {{dueDate}}. Avoid penalties by filing now.',
  },
  {
    event: 'compliance.reminder',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, compliance reminder: {{complianceName}} for {{entityName}} is due on {{dueDate}}.',
  },

  // ────────────────── Ticket Created ──────────────────
  {
    event: 'ticket.created',
    channel: 'EMAIL',
    subject: 'Support Ticket #{{ticketCode}} Created',
    body: '<p>Hello {{customerName}},</p><p>Your support ticket <strong>#{{ticketCode}}</strong> ({{subject}}) has been created. Our team will review and reply shortly.</p>',
  },
  {
    event: 'ticket.created',
    channel: 'SMS',
    body: 'Support ticket {{ticketCode}} received. Our team will review your query shortly.',
  },
  {
    event: 'ticket.created',
    channel: 'PUSH',
    subject: 'Support Ticket Logged',
    body: 'Ticket #{{ticketCode}} has been logged successfully.',
  },
  {
    event: 'ticket.created',
    channel: 'IN_APP',
    subject: 'Support Ticket Created',
    body: 'Support ticket #{{ticketCode}} ({{subject}}) has been created.',
  },
  {
    event: 'ticket.created',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your support ticket #{{ticketCode}} has been created.',
  },

  // ────────────────── Ticket Replied ──────────────────
  {
    event: 'ticket.replied',
    channel: 'EMAIL',
    subject: 'New Reply on Ticket #{{ticketCode}}',
    body: '<p>Hello {{customerName}},</p><p>Our team has replied to your ticket #{{ticketCode}}: <em>"{{replyExcerpt}}"</em>.</p>',
  },
  {
    event: 'ticket.replied',
    channel: 'SMS',
    body: 'New reply received on support ticket {{ticketCode}}. Check your dashboard on BizNexa.',
  },
  {
    event: 'ticket.replied',
    channel: 'PUSH',
    subject: 'New Support Reply',
    body: 'Support has replied to ticket #{{ticketCode}}.',
  },
  {
    event: 'ticket.replied',
    channel: 'IN_APP',
    subject: 'Support Replied',
    body: 'New reply on ticket #{{ticketCode}}: {{replyExcerpt}}.',
  },
  {
    event: 'ticket.replied',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, support has replied to your ticket #{{ticketCode}}.',
  },

  // ────────────────── Ticket Resolved ──────────────────
  {
    event: 'ticket.resolved',
    channel: 'EMAIL',
    subject: 'Ticket #{{ticketCode}} Resolved',
    body: '<p>Hello {{customerName}},</p><p>Your support ticket <strong>#{{ticketCode}}</strong> has been resolved. Resolution: {{resolution}}.</p>',
  },
  {
    event: 'ticket.resolved',
    channel: 'SMS',
    body: 'Support ticket {{ticketCode}} has been resolved. Thank you for contacting BizNexa.',
  },
  {
    event: 'ticket.resolved',
    channel: 'PUSH',
    subject: 'Ticket Resolved',
    body: 'Support ticket #{{ticketCode}} has been resolved.',
  },
  {
    event: 'ticket.resolved',
    channel: 'IN_APP',
    subject: 'Ticket Resolved',
    body: 'Support ticket #{{ticketCode}} has been marked resolved: {{resolution}}.',
  },
  {
    event: 'ticket.resolved',
    channel: 'WHATSAPP',
    body: 'Hello {{customerName}}, your ticket #{{ticketCode}} has been resolved.',
  },
];

export async function seedNotificationTemplates(prisma: PrismaClient): Promise<{ count: number }> {
  for (const t of SEED_NOTIFICATION_TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: {
        event_channel: {
          event: t.event,
          channel: t.channel,
        },
      },
      update: {
        subject: t.subject ?? null,
        body: t.body,
        dltTemplateId: t.dltTemplateId ?? null,
        isActive: true,
      },
      create: {
        event: t.event,
        channel: t.channel,
        subject: t.subject ?? null,
        body: t.body,
        dltTemplateId: t.dltTemplateId ?? null,
        isActive: true,
      },
    });
  }

  console.log(`✓ ${SEED_NOTIFICATION_TEMPLATES.length} notification templates seeded`);
  return { count: SEED_NOTIFICATION_TEMPLATES.length };
}
