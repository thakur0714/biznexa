import { NotificationEventsListener } from './notification-events.listener';
import type { PrismaService } from '../prisma/prisma.service';
import type { EventBus } from '../events/event-bus';
import type { NotificationDispatcherService } from './notification-dispatcher.service';
import type { TemplateEngineService } from './template-engine.service';
import { formatINR } from '@biznexa/types';

describe('NotificationEventsListener (M6.8)', () => {
  let listener: NotificationEventsListener;
  let prisma: Partial<PrismaService>;
  let events: Partial<EventBus>;
  let dispatcher: Partial<NotificationDispatcherService>;
  let templateEngine: Partial<TemplateEngineService>;

  const mockTemplates = [
    {
      id: 'tpl-email-1',
      event: 'payment.succeeded',
      channel: 'EMAIL' as const,
      subject: 'Payment Successful for Order #{{orderId}}',
      body: 'Hello {{customerName}}, payment of Rs. {{amount}} received.',
      isActive: true,
      dltTemplateId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'tpl-inapp-1',
      event: 'payment.succeeded',
      channel: 'IN_APP' as const,
      subject: 'Payment Successful',
      body: 'Your payment of Rs. {{amount}} for Order {{orderId}} was successful.',
      isActive: true,
      dltTemplateId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      } as any,
      order: {
        findUnique: jest.fn(),
      } as any,
      application: {
        findUnique: jest.fn(),
      } as any,
      applicationStageHistory: {
        findFirst: jest.fn(),
      } as any,
      certificate: {
        findUnique: jest.fn(),
      } as any,
      notificationTemplate: {
        findMany: jest.fn().mockResolvedValue(mockTemplates),
      } as any,
    };

    events = {
      on: jest.fn(),
    };

    dispatcher = {
      dispatch: jest.fn().mockResolvedValue({ success: true, channel: 'IN_APP' }),
    };

    templateEngine = {
      render: jest.fn().mockImplementation((template, variables) => ({
        subject: template.subject ? `Rendered: ${template.subject}` : undefined,
        body: `Rendered: ${template.body}`,
      })),
    };

    listener = new NotificationEventsListener(
      prisma as PrismaService,
      events as EventBus,
      dispatcher as NotificationDispatcherService,
      templateEngine as TemplateEngineService,
    );
  });

  describe('onModuleInit', () => {
    it('subscribes to all expected domain events', () => {
      listener.onModuleInit();
      expect(events.on).toHaveBeenCalledWith('payment.succeeded', expect.any(Function));
      expect(events.on).toHaveBeenCalledWith('payment.failed', expect.any(Function));
      expect(events.on).toHaveBeenCalledWith('invoice.issued', expect.any(Function));
      expect(events.on).toHaveBeenCalledWith('document.requested', expect.any(Function));
      expect(events.on).toHaveBeenCalledWith('document.approved', expect.any(Function));
      expect(events.on).toHaveBeenCalledWith('document.rejected', expect.any(Function));
      expect(events.on).toHaveBeenCalledWith('application.status_changed', expect.any(Function));
      expect(events.on).toHaveBeenCalledWith('certificate.issued', expect.any(Function));
    });
  });

  describe('payment.succeeded', () => {
    it('finds customer, formats amount with formatINR, and dispatches to active templates', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        name: 'Alice Sharma',
        email: 'alice@example.com',
        mobile: '9876543210',
      });
      (prisma.order!.findUnique as jest.Mock).mockResolvedValue({
        id: 'ord-1',
        code: 'ORD-2026-0001',
      });

      await listener.handlePaymentSucceeded({
        paymentId: 'pay-1',
        orderId: 'ord-1',
        customerId: 'cust-1',
        applicationIds: ['app-1'],
        amount: 500000,
        gateway: 'RAZORPAY',
        gatewayPaymentId: 'pay_123',
      });

      expect(prisma.notificationTemplate!.findMany).toHaveBeenCalledWith({
        where: { event: 'payment.succeeded', isActive: true },
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'EMAIL' }),
        expect.objectContaining({
          customerName: 'Alice Sharma',
          orderId: 'ORD-2026-0001',
          amount: formatINR(500000),
        }),
      );

      expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
      expect(dispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cust-1',
          channel: 'EMAIL',
          event: 'payment.succeeded',
          recipient: { email: 'alice@example.com', mobile: '9876543210' },
        }),
      );
    });
  });

  describe('payment.failed', () => {
    it('dispatches payment.failed notification with reason and formatted amount', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        name: 'Alice Sharma',
        email: 'alice@example.com',
      });
      (prisma.order!.findUnique as jest.Mock).mockResolvedValue({
        id: 'ord-1',
        code: 'ORD-2026-0001',
      });

      await listener.handlePaymentFailed({
        paymentId: 'pay-1',
        orderId: 'ord-1',
        customerId: 'cust-1',
        amount: 250000,
        reason: 'Insufficient funds',
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customerName: 'Alice Sharma',
          orderId: 'ORD-2026-0001',
          amount: formatINR(250000),
          reason: 'Insufficient funds',
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });
  });

  describe('invoice.issued', () => {
    it('dispatches invoice.issued with invoiceNumber and formatted total', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        name: 'Alice Sharma',
        email: 'alice@example.com',
      });
      (prisma.order!.findUnique as jest.Mock).mockResolvedValue({
        id: 'ord-1',
        code: 'ORD-2026-0001',
      });

      await listener.handleInvoiceIssued({
        invoiceId: 'inv-1',
        number: 'INV-2026-0042',
        paymentId: 'pay-1',
        orderId: 'ord-1',
        customerId: 'cust-1',
        total: 1000000,
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customerName: 'Alice Sharma',
          invoiceNumber: 'INV-2026-0042',
          total: formatINR(1000000),
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });
  });

  describe('document events', () => {
    const mockApp = {
      id: 'app-1',
      code: 'APP-2026-0099',
      customerId: 'cust-1',
      service: {
        id: 'srv-1',
        name: 'Private Limited Company Registration',
      },
    };

    beforeEach(() => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        name: 'Bob Builder',
        email: 'bob@example.com',
        mobile: '9123456789',
      });
    });

    it('document.requested renders application details and document name', async () => {
      (prisma.application!.findUnique as jest.Mock).mockResolvedValue(mockApp);

      await listener.handleDocumentRequested({
        documentId: 'doc-1',
        applicationId: 'app-1',
        name: 'PAN Card',
        reason: 'Front side clear copy required',
        actorId: 'admin-1',
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customerName: 'Bob Builder',
          documentName: 'PAN Card',
          applicationNumber: 'APP-2026-0099',
          applicationCode: 'APP-2026-0099',
          serviceName: 'Private Limited Company Registration',
          reason: 'Front side clear copy required',
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });

    it('document.approved renders application details and document name', async () => {
      (prisma.application!.findUnique as jest.Mock).mockResolvedValue(mockApp);

      await listener.handleDocumentApproved({
        documentId: 'doc-1',
        applicationId: 'app-1',
        name: 'Certificate of Incorporation',
        actorId: 'admin-1',
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customerName: 'Bob Builder',
          documentName: 'Certificate of Incorporation',
          applicationNumber: 'APP-2026-0099',
          serviceName: 'Private Limited Company Registration',
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });

    it('document.rejected renders document name and rejection reason', async () => {
      (prisma.application!.findUnique as jest.Mock).mockResolvedValue(mockApp);

      await listener.handleDocumentRejected({
        documentId: 'doc-1',
        applicationId: 'app-1',
        name: 'Utility Bill',
        reason: 'Older than 2 months',
        actorId: 'admin-1',
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customerName: 'Bob Builder',
          documentName: 'Utility Bill',
          applicationNumber: 'APP-2026-0099',
          reason: 'Older than 2 months',
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });
  });

  describe('application.status_changed', () => {
    it('skips notification when status is DRAFT or PAYMENT_PENDING', async () => {
      await listener.handleApplicationStatusChanged({
        applicationId: 'app-1',
        from: 'DRAFT',
        to: 'PAYMENT_PENDING',
        actorId: 'cust-1',
      });

      expect(prisma.application!.findUnique).not.toHaveBeenCalled();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('skips notification when transition was not visible to customer', async () => {
      (prisma.applicationStageHistory!.findFirst as jest.Mock).mockResolvedValue({
        visibleToCustomer: false,
      });

      await listener.handleApplicationStatusChanged({
        applicationId: 'app-1',
        from: 'IN_PROGRESS',
        to: 'ON_HOLD',
        actorId: 'staff-1',
        reason: 'Internal ROC investigation',
      });

      expect(prisma.application!.findUnique).not.toHaveBeenCalled();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('dispatches when transition is visible to customer', async () => {
      (prisma.applicationStageHistory!.findFirst as jest.Mock).mockResolvedValue({
        visibleToCustomer: true,
      });
      (prisma.application!.findUnique as jest.Mock).mockResolvedValue({
        id: 'app-1',
        code: 'APP-2026-0099',
        customerId: 'cust-1',
        service: { id: 'srv-1', name: 'GST Registration' },
      });
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        name: 'Bob Builder',
        email: 'bob@example.com',
      });

      await listener.handleApplicationStatusChanged({
        applicationId: 'app-1',
        from: 'DOCUMENTS_APPROVED',
        to: 'IN_PROGRESS',
        actorId: 'staff-1',
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customerName: 'Bob Builder',
          applicationNumber: 'APP-2026-0099',
          status: 'In Progress',
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });
  });

  describe('certificate.issued', () => {
    it('finds certificate and customer from linked application, then dispatches', async () => {
      (prisma.certificate!.findUnique as jest.Mock).mockResolvedValue({
        id: 'cert-1',
        certificateNumber: 'BNC-2026-0001',
        organizationName: 'Acme Pvt Ltd',
        application: {
          id: 'app-1',
          code: 'APP-1',
          customerId: 'cust-1',
          service: { id: 'srv-1', name: 'ISO Certification' },
        },
        businessEntity: null,
      });
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        name: 'Alice Customer',
        email: 'alice@example.com',
      });

      await listener.handleCertificateIssued({
        certificateId: 'cert-1',
        certificateNumber: 'BNC-2026-0001',
        status: 'ACTIVE',
        actorId: 'admin-1',
      });

      expect(templateEngine.render).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          customerName: 'Alice Customer',
          certificateNumber: 'BNC-2026-0001',
          entityName: 'Acme Pvt Ltd',
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });
  });

  describe('channel filtering and error resilience', () => {
    it('skips channel without an active template', async () => {
      // Return only SMS template
      (prisma.notificationTemplate!.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'tpl-sms-only',
          event: 'payment.succeeded',
          channel: 'SMS' as const,
          body: 'SMS notification',
          isActive: true,
        },
      ]);
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'User 1' });
      (prisma.order!.findUnique as jest.Mock).mockResolvedValue({ id: 'o1', code: 'ORD-1' });

      await listener.handlePaymentSucceeded({
        paymentId: 'p1',
        orderId: 'o1',
        customerId: 'u1',
        applicationIds: [],
        amount: 1000,
        gateway: 'MOCK',
        gatewayPaymentId: 'mock-1',
      });

      expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
      expect(dispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'SMS' }),
      );
    });

    it('swallows dispatcher error without throwing', async () => {
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'User 1' });
      (prisma.order!.findUnique as jest.Mock).mockResolvedValue({ id: 'o1', code: 'ORD-1' });
      (dispatcher.dispatch as jest.Mock).mockRejectedValue(new Error('Network failure'));

      await expect(
        listener.handlePaymentSucceeded({
          paymentId: 'p1',
          orderId: 'o1',
          customerId: 'u1',
          applicationIds: [],
          amount: 1000,
          gateway: 'MOCK',
          gatewayPaymentId: 'mock-1',
        }),
      ).resolves.not.toThrow();
    });
  });
});
