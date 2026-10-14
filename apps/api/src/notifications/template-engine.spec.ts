import {
  TemplateEngineService,
  TemplateNotFoundError,
  MissingTemplateVariableError,
} from './template-engine.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SEED_NOTIFICATION_TEMPLATES } from '../../prisma/seed-notifications';

describe('TemplateEngineService', () => {
  let service: TemplateEngineService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      notificationTemplate: {
        findUnique: jest.fn(),
      },
    };
    service = new TemplateEngineService(mockPrisma as PrismaService);
  });

  describe('rendering', () => {
    it('renders variables in subject and body', () => {
      const template = {
        event: 'payment.success',
        channel: 'EMAIL' as const,
        subject: 'Payment of Rs. {{amount}} Received for Order {{orderId}}',
        body: '<p>Hello {{customerName}}, your payment of Rs. {{amount}} was successful.</p>',
      };

      const result = service.render(template, {
        customerName: 'Aarav Sharma',
        amount: 4999,
        orderId: 'ORD-101',
      });

      expect(result.subject).toBe('Payment of Rs. 4999 Received for Order ORD-101');
      expect(result.body).toBe('<p>Hello Aarav Sharma, your payment of Rs. 4999 was successful.</p>');
    });

    it('handles whitespace inside placeholders like {{ variable }}', () => {
      const template = {
        channel: 'SMS' as const,
        body: 'Hello {{ customerName }}, your code is {{   code   }}.',
      };

      const result = service.render(template, {
        customerName: 'Priya',
        code: 987654,
      });

      expect(result.body).toBe('Hello Priya, your code is 987654.');
    });

    it('renders without subject when subject is null or undefined', () => {
      const template = {
        channel: 'SMS' as const,
        body: 'Your OTP is {{otp}}.',
      };

      const result = service.render(template, { otp: '456789' });
      expect(result.subject).toBeUndefined();
      expect(result.body).toBe('Your OTP is 456789.');
    });
  });

  describe('escaping HTML', () => {
    it('escapes HTML special characters for EMAIL channel', () => {
      const template = {
        channel: 'EMAIL' as const,
        subject: 'Update for {{companyName}}',
        body: '<p>Welcome {{companyName}}, {{owner}} and {{code}}.</p>',
      };

      const result = service.render(template, {
        companyName: '<Acme & Co>',
        owner: "O'Connor",
        code: '"VIP"',
      });

      expect(result.subject).toBe('Update for &lt;Acme &amp; Co&gt;');
      expect(result.body).toBe('<p>Welcome &lt;Acme &amp; Co&gt;, O&#39;Connor and &quot;VIP&quot;.</p>');
    });

    it('escapes HTML special characters for IN_APP channel', () => {
      const template = {
        channel: 'IN_APP' as const,
        subject: 'Notice for {{name}}',
        body: 'Attention: <script>alert("xss")</script> from {{name}}.',
      };

      const result = service.render(template, {
        name: '<b>Malicious</b>',
      });

      expect(result.subject).toBe('Notice for &lt;b&gt;Malicious&lt;/b&gt;');
      // Variable value is escaped
      expect(result.body).toContain('&lt;b&gt;Malicious&lt;/b&gt;');
    });

    it('does NOT escape HTML for SMS, PUSH, and WHATSAPP channels', () => {
      const vars = {
        company: 'R&D Solutions <India>',
        quote: '"Fast & Reliable"',
      };

      const sms = service.render(
        { channel: 'SMS', body: 'Service for {{company}}: {{quote}}' },
        vars,
      );
      expect(sms.body).toBe('Service for R&D Solutions <India>: "Fast & Reliable"');

      const push = service.render(
        { channel: 'PUSH', subject: '{{company}}', body: '{{quote}}' },
        vars,
      );
      expect(push.subject).toBe('R&D Solutions <India>');
      expect(push.body).toBe('"Fast & Reliable"');

      const whatsapp = service.render(
        { channel: 'WHATSAPP', body: 'Hello from {{company}} - {{quote}}' },
        vars,
      );
      expect(whatsapp.body).toBe('Hello from R&D Solutions <India> - "Fast & Reliable"');
    });
  });

  describe('missing variables', () => {
    it('throws MissingTemplateVariableError when a variable is missing in body', () => {
      const template = {
        channel: 'EMAIL' as const,
        subject: 'Hello',
        body: 'Your total is {{amount}} for {{orderId}}.',
      };

      expect(() =>
        service.render(template, { amount: 500 }),
      ).toThrow(MissingTemplateVariableError);

      expect(() =>
        service.render(template, { amount: 500 }),
      ).toThrow('Missing required variable(s): orderId');
    });

    it('throws MissingTemplateVariableError when a variable is missing in subject', () => {
      const template = {
        channel: 'EMAIL' as const,
        subject: 'Receipt #{{receiptNumber}}',
        body: 'Thank you for your business.',
      };

      expect(() =>
        service.render(template, {}),
      ).toThrow(MissingTemplateVariableError);

      expect(() =>
        service.render(template, {}),
      ).toThrow('Missing required variable(s): receiptNumber');
    });

    it('throws MissingTemplateVariableError when a variable is null or undefined', () => {
      const template = {
        channel: 'SMS' as const,
        body: 'Dear {{customerName}}, your status is {{status}}.',
      };

      expect(() =>
        service.render(template, { customerName: null, status: undefined }),
      ).toThrow(MissingTemplateVariableError);
    });

    it('never sends raw placeholder {{name}} to user', () => {
      const template = {
        channel: 'SMS' as const,
        body: 'Hi {{name}}, your balance is {{balance}}.',
      };

      try {
        service.render(template, { name: 'Aarav' });
        fail('Should have thrown MissingTemplateVariableError');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingTemplateVariableError);
      }
    });
  });

  describe('unknown template', () => {
    it('throws TemplateNotFoundError when template is not found in database', async () => {
      mockPrisma.notificationTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.renderTemplate('unknown.event', 'EMAIL', { foo: 'bar' }),
      ).rejects.toThrow(TemplateNotFoundError);

      await expect(
        service.renderTemplate('unknown.event', 'EMAIL', { foo: 'bar' }),
      ).rejects.toThrow('Notification template not found for event="unknown.event" channel="EMAIL"');
    });

    it('throws TemplateNotFoundError when template is inactive', async () => {
      mockPrisma.notificationTemplate.findUnique.mockResolvedValue({
        event: 'payment.success',
        channel: 'EMAIL',
        subject: 'Payment Received',
        body: 'Thank you {{customerName}}',
        isActive: false,
      });

      await expect(
        service.renderTemplate('payment.success', 'EMAIL', { customerName: 'Aarav' }),
      ).rejects.toThrow(TemplateNotFoundError);

      await expect(
        service.renderTemplate('payment.success', 'EMAIL', { customerName: 'Aarav' }),
      ).rejects.toThrow('Notification template for event="payment.success" channel="EMAIL" is inactive');
    });

    it('renders successfully when template is found in database', async () => {
      mockPrisma.notificationTemplate.findUnique.mockResolvedValue({
        event: 'auth.otp',
        channel: 'SMS',
        subject: null,
        body: 'Your OTP is {{otp}}.',
        isActive: true,
      });

      const res = await service.renderTemplate('auth.otp', 'SMS', { otp: '123456' });
      expect(res.body).toBe('Your OTP is 123456.');
      expect(res.subject).toBeUndefined();
    });
  });

  describe('seed templates for §7.9 events', () => {
    it('contains seed templates for every event in §7.9 across channels', () => {
      const expectedEvents = [
        'registration',
        'otp',
        'payment.success',
        'payment.failure',
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
      ];

      const seededEvents = new Set(SEED_NOTIFICATION_TEMPLATES.map((t) => t.event));
      for (const ev of expectedEvents) {
        expect(seededEvents.has(ev)).toBe(true);
      }

      // Check all 5 channels are covered for each core event
      const channels = ['EMAIL', 'SMS', 'PUSH', 'IN_APP', 'WHATSAPP'];
      for (const ev of expectedEvents) {
        for (const ch of channels) {
          const match = SEED_NOTIFICATION_TEMPLATES.find((t) => t.event === ev && t.channel === ch);
          expect(match).toBeDefined();
          expect(match?.body.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
