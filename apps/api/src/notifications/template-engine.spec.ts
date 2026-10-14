import {
  TemplateEngineService,
  TemplateNotFoundError,
  MissingTemplateVariableError,
} from './template-engine.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SEED_NOTIFICATION_TEMPLATES } from '../../prisma/seed-notifications';
import { NOTIFICATION_EVENTS } from '@biznexa/types';

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
        event: 'payment.succeeded',
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
    it('escapes HTML special characters only for EMAIL channel', () => {
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

    it('does NOT escape HTML for IN_APP, SMS, PUSH, and WHATSAPP channels', () => {
      const vars = {
        company: 'R&D Solutions <India>',
        quote: '"Fast & Reliable"',
      };

      const inApp = service.render(
        { channel: 'IN_APP', subject: 'Notice for {{company}}', body: 'Service {{quote}}' },
        vars,
      );
      // React escapes text on its own, so IN_APP does not HTML-escape values
      expect(inApp.subject).toBe('Notice for R&D Solutions <India>');
      expect(inApp.body).toBe('Service "Fast & Reliable"');

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
        event: 'payment.succeeded',
        channel: 'EMAIL',
        subject: 'Payment Received',
        body: 'Thank you {{customerName}}',
        isActive: false,
      });

      await expect(
        service.renderTemplate('payment.succeeded', 'EMAIL', { customerName: 'Aarav' }),
      ).rejects.toThrow(TemplateNotFoundError);

      await expect(
        service.renderTemplate('payment.succeeded', 'EMAIL', { customerName: 'Aarav' }),
      ).rejects.toThrow('Notification template for event="payment.succeeded" channel="EMAIL" is inactive');
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
    it('contains seed templates for every event in NOTIFICATION_EVENTS across all 5 channels', () => {
      const seededEvents = new Set(SEED_NOTIFICATION_TEMPLATES.map((t) => t.event));
      for (const ev of NOTIFICATION_EVENTS) {
        expect(seededEvents.has(ev)).toBe(true);
      }
      expect(seededEvents.size).toBe(NOTIFICATION_EVENTS.length);
    });

    it('has no duplicate (event, channel) pairs and every event is in NOTIFICATION_EVENTS', () => {
      const validEventSet = new Set<string>(NOTIFICATION_EVENTS);
      const seenPairs = new Set<string>();

      for (const t of SEED_NOTIFICATION_TEMPLATES) {
        expect(validEventSet.has(t.event)).toBe(true);
        const key = `${t.event}::${t.channel}`;
        expect(seenPairs.has(key)).toBe(false);
        seenPairs.add(key);
        expect(t.dltTemplateId ?? null).toBeNull();
      }

      expect(SEED_NOTIFICATION_TEMPLATES.length).toBe(NOTIFICATION_EVENTS.length * 5);
    });
  });
});
