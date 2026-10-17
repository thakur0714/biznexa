import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  APPLICATION_STATUS_LABEL,
  formatINR,
  type ApplicationStatus,
  type DomainEventPayloads,
  type NotificationEvent,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../events/event-bus';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { TemplateEngineService } from './template-engine.service';
import { env } from '../config/env';

@Injectable()
export class NotificationEventsListener implements OnModuleInit {
  private readonly logger = new Logger(NotificationEventsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly templateEngine: TemplateEngineService,
  ) {}

  onModuleInit() {
    this.events.on('payment.succeeded', (e) => this.handlePaymentSucceeded(e.payload));
    this.events.on('payment.failed', (e) => this.handlePaymentFailed(e.payload));
    this.events.on('invoice.issued', (e) => this.handleInvoiceIssued(e.payload));
    this.events.on('refund.processed', (e) => this.handleRefundProcessed(e.payload));
    this.events.on('document.requested', (e) => this.handleDocumentRequested(e.payload));
    this.events.on('document.approved', (e) => this.handleDocumentApproved(e.payload));
    this.events.on('document.rejected', (e) => this.handleDocumentRejected(e.payload));
    this.events.on('application.status_changed', (e) => this.handleApplicationStatusChanged(e.payload));
    this.events.on('certificate.issued', (e) => this.handleCertificateIssued(e.payload));
    this.events.on('message.created', (e) => this.handleMessageCreated(e.payload));
    this.events.on('ticket.created', (e) => this.handleTicketCreated(e.payload));
    this.events.on('ticket.replied', (e) => this.handleTicketReplied(e.payload));
    this.events.on('ticket.resolved', (e) => this.handleTicketResolved(e.payload));
    this.events.on('privacy.export_ready', (e) => this.handleExportReady(e.payload));
    this.events.on('privacy.request_rejected', (e) => this.handlePrivacyRejected(e.payload));
    this.events.on('privacy.account_deleted', (e) => this.handleAccountDeleted(e.payload));
  }

  async handlePaymentSucceeded(payload: DomainEventPayloads['payment.succeeded']): Promise<void> {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${payload.customerId} not found for payment.succeeded`);
        return;
      }

      const order = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
        select: { id: true, code: true },
      });

      const orderCode = order?.code ?? payload.orderId;
      const formattedAmount = formatINR(payload.amount);
      const link = `${env().PUBLIC_WEB_URL}/dashboard`;

      const variables: Record<string, unknown> = {
        customerName: customer.name,
        orderId: orderCode,
        orderCode,
        amount: formattedAmount,
        link,
      };

      await this.dispatchForEvent('payment.succeeded', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling payment.succeeded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handlePaymentFailed(payload: DomainEventPayloads['payment.failed']): Promise<void> {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${payload.customerId} not found for payment.failed`);
        return;
      }

      const order = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
        select: { id: true, code: true },
      });

      const orderCode = order?.code ?? payload.orderId;
      const formattedAmount = formatINR(payload.amount);
      const link = `${env().PUBLIC_WEB_URL}/dashboard`;

      const variables: Record<string, unknown> = {
        customerName: customer.name,
        orderId: orderCode,
        orderCode,
        amount: formattedAmount,
        reason: payload.reason || 'Payment was declined by your bank or gateway.',
        link,
      };

      await this.dispatchForEvent('payment.failed', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling payment.failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleInvoiceIssued(payload: DomainEventPayloads['invoice.issued']): Promise<void> {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${payload.customerId} not found for invoice.issued`);
        return;
      }

      const order = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
        select: { id: true, code: true },
      });

      const orderCode = order?.code ?? payload.orderId;
      const formattedTotal = formatINR(payload.total);
      const link = `${env().PUBLIC_WEB_URL}/dashboard`;

      const variables: Record<string, unknown> = {
        customerName: customer.name,
        invoiceNumber: payload.number,
        total: formattedTotal,
        orderId: orderCode,
        orderCode,
        link,
      };

      await this.dispatchForEvent('invoice.issued', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling invoice.issued: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleRefundProcessed(payload: DomainEventPayloads['refund.processed']): Promise<void> {
    try {
      if (!payload.customerId) return;
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${payload.customerId} not found for refund.processed`);
        return;
      }

      const order = payload.orderId ? await this.prisma.order.findUnique({ where: { id: payload.orderId }, select: { code: true } }) : null;
      const orderCode = order?.code ?? payload.orderId ?? '';
      const link = `${env().PUBLIC_WEB_URL}/dashboard/payments`;

      const variables: Record<string, unknown> = {
        customerName: customer.name,
        orderId: orderCode,
        orderCode,
        amount: formatINR(payload.amount),
        link,
      };

      await this.dispatchForEvent('refund.processed', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling refund.processed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleDocumentRequested(payload: DomainEventPayloads['document.requested']): Promise<void> {
    try {
      const app = await this.prisma.application.findUnique({
        where: { id: payload.applicationId },
        select: {
          id: true,
          code: true,
          customerId: true,
          service: { select: { id: true, name: true } },
        },
      });
      if (!app) {
        this.logger.warn(`Application not found for document.requested (${payload.applicationId})`);
        return;
      }

      const customer = await this.prisma.user.findUnique({
        where: { id: app.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${app.customerId} not found for document.requested`);
        return;
      }

      const link = `${env().PUBLIC_WEB_URL}/dashboard`;
      const variables: Record<string, unknown> = {
        customerName: customer.name,
        documentName: payload.name,
        applicationNumber: app.code,
        applicationCode: app.code,
        serviceName: app.service.name,
        reason: payload.reason ?? '',
        link,
      };

      await this.dispatchForEvent('document.requested', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling document.requested: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleDocumentApproved(payload: DomainEventPayloads['document.approved']): Promise<void> {
    try {
      const app = await this.prisma.application.findUnique({
        where: { id: payload.applicationId },
        select: {
          id: true,
          code: true,
          customerId: true,
          service: { select: { id: true, name: true } },
        },
      });
      if (!app) {
        this.logger.warn(`Application not found for document.approved (${payload.applicationId})`);
        return;
      }

      const customer = await this.prisma.user.findUnique({
        where: { id: app.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${app.customerId} not found for document.approved`);
        return;
      }

      const link = `${env().PUBLIC_WEB_URL}/dashboard`;
      const variables: Record<string, unknown> = {
        customerName: customer.name,
        documentName: payload.name,
        applicationNumber: app.code,
        applicationCode: app.code,
        serviceName: app.service.name,
        reason: payload.reason ?? '',
        link,
      };

      await this.dispatchForEvent('document.approved', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling document.approved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleDocumentRejected(payload: DomainEventPayloads['document.rejected']): Promise<void> {
    try {
      const app = await this.prisma.application.findUnique({
        where: { id: payload.applicationId },
        select: {
          id: true,
          code: true,
          customerId: true,
          service: { select: { id: true, name: true } },
        },
      });
      if (!app) {
        this.logger.warn(`Application not found for document.rejected (${payload.applicationId})`);
        return;
      }

      const customer = await this.prisma.user.findUnique({
        where: { id: app.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${app.customerId} not found for document.rejected`);
        return;
      }

      const link = `${env().PUBLIC_WEB_URL}/dashboard`;
      const variables: Record<string, unknown> = {
        customerName: customer.name,
        documentName: payload.name,
        applicationNumber: app.code,
        applicationCode: app.code,
        serviceName: app.service.name,
        reason: payload.reason ?? 'Document did not meet requirements',
        link,
      };

      await this.dispatchForEvent('document.rejected', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling document.rejected: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleApplicationStatusChanged(payload: DomainEventPayloads['application.status_changed']): Promise<void> {
    try {
      // Internal or pre-submission states are not visible to customer
      if ((payload.to as ApplicationStatus) === 'DRAFT' || (payload.to as ApplicationStatus) === 'PAYMENT_PENDING') {
        return;
      }

      // Check whether this status transition was flagged as visible to customer
      const history = await this.prisma.applicationStageHistory.findFirst({
        where: { applicationId: payload.applicationId, status: payload.to },
        orderBy: { changedAt: 'desc' },
        select: { visibleToCustomer: true },
      });
      if (history && history.visibleToCustomer === false) {
        return;
      }

      const app = await this.prisma.application.findUnique({
        where: { id: payload.applicationId },
        select: {
          id: true,
          code: true,
          customerId: true,
          service: { select: { id: true, name: true } },
        },
      });
      if (!app) {
        this.logger.warn(`Application not found for application.status_changed (${payload.applicationId})`);
        return;
      }

      const customer = await this.prisma.user.findUnique({
        where: { id: app.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${app.customerId} not found for application.status_changed`);
        return;
      }

      const link = `${env().PUBLIC_WEB_URL}/dashboard`;
      const statusLabel = APPLICATION_STATUS_LABEL[payload.to as ApplicationStatus] ?? payload.to;

      const variables: Record<string, unknown> = {
        customerName: customer.name,
        applicationNumber: app.code,
        applicationCode: app.code,
        serviceName: app.service.name,
        status: statusLabel,
        reason: payload.reason ?? '',
        link,
      };

      await this.dispatchForEvent('application.status_changed', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling application.status_changed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleCertificateIssued(payload: DomainEventPayloads['certificate.issued']): Promise<void> {
    try {
      const cert = await this.prisma.certificate.findUnique({
        where: { id: payload.certificateId },
        include: {
          application: {
            select: {
              id: true,
              code: true,
              customerId: true,
              service: { select: { id: true, name: true } },
            },
          },
          businessEntity: {
            select: {
              id: true,
              legalName: true,
              ownerId: true,
            },
          },
        },
      });
      if (!cert) {
        this.logger.warn(`Certificate not found for certificate.issued (${payload.certificateId})`);
        return;
      }

      const customerId = cert.application?.customerId ?? cert.businessEntity?.ownerId;
      if (!customerId) {
        this.logger.warn(`Customer ID not found for certificate.issued (${payload.certificateId})`);
        return;
      }

      const customer = await this.prisma.user.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) {
        this.logger.warn(`Customer ${customerId} not found for certificate.issued`);
        return;
      }

      const link = `${env().PUBLIC_WEB_URL}/dashboard/certificates`;
      const entityName = cert.organizationName || cert.businessEntity?.legalName || 'your business';

      const variables: Record<string, unknown> = {
        customerName: customer.name,
        certificateNumber: cert.certificateNumber,
        entityName,
        applicationNumber: cert.application?.code ?? '',
        applicationCode: cert.application?.code ?? '',
        serviceName: cert.application?.service?.name ?? '',
        link,
      };

      await this.dispatchForEvent('certificate.issued', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling certificate.issued: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async dispatchForEvent(
    event: NotificationEvent,
    recipient: { id: string; name: string; email?: string | null; mobile?: string | null },
    variables: Record<string, unknown>,
    link?: string,
    allowedChannels?: string[],
  ): Promise<void> {
    let templates = await this.prisma.notificationTemplate.findMany({
      where: {
        event,
        isActive: true,
      },
    });

    if (allowedChannels) {
      templates = templates.filter(t => allowedChannels.includes(t.channel));
    }

    for (const template of templates) {
      try {
        const rendered = this.templateEngine.render(template, variables);
        await this.dispatcher.dispatch({
          userId: recipient.id,
          channel: template.channel,
          event,
          title: rendered.subject,
          body: rendered.body,
          payload: variables,
          link,
          recipient: {
            email: recipient.email ?? undefined,
            mobile: recipient.mobile ?? undefined,
          },
        });
      } catch (err) {
        this.logger.error(
          `Failed to dispatch notification for event "${event}" on channel "${template.channel}" to user "${recipient.id}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async handleMessageCreated(payload: DomainEventPayloads['message.created']): Promise<void> {
    try {
      const app = await this.prisma.application.findUnique({
        where: { id: payload.applicationId },
        select: {
          id: true,
          code: true,
          customerId: true,
          assignedToId: true,
          service: { select: { id: true, name: true } },
        },
      });
      if (!app) {
        this.logger.warn(`Application not found for message.created (${payload.applicationId})`);
        return;
      }

      const message = await this.prisma.message.findUnique({
        where: { id: payload.messageId },
        select: { body: true, sender: { select: { id: true, name: true } } },
      });
      if (!message) {
        this.logger.warn(`Message not found for message.created (${payload.messageId})`);
        return;
      }

      const bodyText = message.body || '';
      const link = `${env().PUBLIC_WEB_URL}/dashboard/applications/${app.id}`;
      const messageExcerpt = bodyText.length > 120 ? bodyText.substring(0, 120) + '...' : bodyText;

      if (payload.fromStaff) {
        // Notify customer on all channels
        const customer = await this.prisma.user.findUnique({
          where: { id: app.customerId },
          select: { id: true, name: true, email: true, mobile: true },
        });
        if (!customer) {
          this.logger.warn(`Customer ${app.customerId} not found for message.created`);
          return;
        }

        const variables: Record<string, unknown> = {
          recipientName: customer.name,
          applicationCode: app.code,
          serviceName: app.service.name,
          senderName: message.sender.name,
          messageExcerpt,
          link,
        };

        await this.dispatchForEvent('message.received', customer, variables, link);
      } else {
        // Notify assigned staff on IN_APP only
        if (!app.assignedToId) return;

        const staff = await this.prisma.user.findUnique({
          where: { id: app.assignedToId },
          select: { id: true, name: true, email: true, mobile: true },
        });
        if (!staff) {
          this.logger.warn(`Staff ${app.assignedToId} not found for message.created`);
          return;
        }

        const variables: Record<string, unknown> = {
          recipientName: staff.name,
          applicationCode: app.code,
          serviceName: app.service.name,
          senderName: message.sender.name,
          messageExcerpt,
          link,
        };

        await this.dispatchForEvent('message.received', staff, variables, link, ['IN_APP']);
      }
    } catch (err) {
      this.logger.error(`Error handling message.created: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleTicketCreated(payload: DomainEventPayloads['ticket.created']): Promise<void> {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) return;

      const link = `${env().PUBLIC_WEB_URL}/dashboard/support`;
      const variables: Record<string, unknown> = {
        customerName: customer.name,
        ticketCode: payload.ticketCode,
        subject: payload.subject,
        link,
      };

      await this.dispatchForEvent('ticket.created', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling ticket.created: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleTicketReplied(payload: DomainEventPayloads['ticket.replied']): Promise<void> {
    try {
      // Only notify customer on staff replies
      if (!payload.fromStaff) return;

      const customer = await this.prisma.user.findUnique({
        where: { id: payload.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) return;

      const link = `${env().PUBLIC_WEB_URL}/dashboard/support`;
      const variables: Record<string, unknown> = {
        customerName: customer.name,
        ticketCode: payload.ticketCode,
        replyExcerpt: payload.replyExcerpt,
        link,
      };

      await this.dispatchForEvent('ticket.replied', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling ticket.replied: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleTicketResolved(payload: DomainEventPayloads['ticket.resolved']): Promise<void> {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.customerId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) return;

      const link = `${env().PUBLIC_WEB_URL}/dashboard/support`;
      const variables: Record<string, unknown> = {
        customerName: customer.name,
        ticketCode: payload.ticketCode,
        resolution: payload.resolution ?? 'Resolved by support team',
        link,
      };

      await this.dispatchForEvent('ticket.resolved', customer, variables, link);
    } catch (err) {
      this.logger.error(`Error handling ticket.resolved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleExportReady(payload: DomainEventPayloads['privacy.export_ready']): Promise<void> {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) return;

      const link = `${env().PUBLIC_WEB_URL}/dashboard/privacy`;
      const expiresOn = new Date(payload.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      await this.dispatchForEvent('privacy.export_ready', customer, { customerName: customer.name, expiresOn, link }, link);
    } catch (err) {
      this.logger.error(`Error handling privacy.export_ready: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handlePrivacyRejected(payload: DomainEventPayloads['privacy.request_rejected']): Promise<void> {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, name: true, email: true, mobile: true },
      });
      if (!customer) return;

      const link = `${env().PUBLIC_WEB_URL}/dashboard/privacy`;
      const requestType = payload.type === 'EXPORT' ? 'data export' : 'account deletion';
      await this.dispatchForEvent('privacy.request_rejected', customer, { customerName: customer.name, requestType, reason: payload.reason, link }, link);
    } catch (err) {
      this.logger.error(`Error handling privacy.request_rejected: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The account is already anonymised: use the contact details carried by the event, and never in-app or push. */
  async handleAccountDeleted(payload: DomainEventPayloads['privacy.account_deleted']): Promise<void> {
    try {
      const recipient = { id: payload.userId, name: payload.name, email: payload.email, mobile: payload.mobile };
      await this.dispatchForEvent('privacy.account_deleted', recipient, { customerName: payload.name }, undefined, ['EMAIL', 'SMS']);
    } catch (err) {
      this.logger.error(`Error handling privacy.account_deleted: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
