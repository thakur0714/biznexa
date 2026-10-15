import { EmailChannel } from './email.channel';
import { FakeEmailProvider, SendGridEmailProvider, SmtpEmailProvider } from '../providers/email.provider';
import type { TemplateEngineService } from '../template-engine.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('EmailChannel (M6.4)', () => {
  let fakeProvider: FakeEmailProvider;
  let mockTemplateEngine: {
    renderTemplate: jest.Mock;
    render: jest.Mock;
  };
  let mockPrisma: {
    user: {
      findUnique: jest.Mock;
    };
  };
  let channel: EmailChannel;

  beforeEach(() => {
    fakeProvider = new FakeEmailProvider();
    mockTemplateEngine = {
      renderTemplate: jest.fn().mockResolvedValue({
        subject: 'Tax Invoice #BN-100 Issued',
        body: '<p>Hello Alice, your invoice is ready.</p>',
      }),
      render: jest.fn(),
    };
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'alice@example.com' }),
      },
    };
    channel = new EmailChannel(
      fakeProvider,
      mockTemplateEngine as unknown as TemplateEngineService,
      mockPrisma as unknown as PrismaService,
    );
  });

  it('renders subject and body from TemplateEngineService and sends via provider', async () => {
    const res = await channel.send({
      userId: 'user-123',
      channel: 'EMAIL',
      event: 'payment.succeeded',
      body: 'ignored-body',
      payload: { customerName: 'Alice', amount: '4999', orderId: 'ORD-1' },
      recipient: { email: 'alice@example.com' },
    });

    expect(res.success).toBe(true);
    expect(res.channel).toBe('EMAIL');
    expect(fakeProvider.sentEmails).toHaveLength(1);
    const sent = fakeProvider.sentEmails[0];
    expect(sent.to).toBe('alice@example.com');
    expect(sent.subject).toBe('Tax Invoice #BN-100 Issued');
    expect(sent.html).toBe('<p>Hello Alice, your invoice is ready.</p>');
    expect(mockTemplateEngine.renderTemplate).toHaveBeenCalledWith(
      'payment.succeeded',
      'EMAIL',
      { customerName: 'Alice', amount: '4999', orderId: 'ORD-1' },
    );
  });

  it('resolves email from user record if recipient.email is missing', async () => {
    const res = await channel.send({
      userId: 'user-456',
      channel: 'EMAIL',
      event: 'auth.registered',
      body: 'Welcome',
      payload: { customerName: 'Bob' },
    });

    expect(res.success).toBe(true);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-456' },
      select: { email: true },
    });
    expect(fakeProvider.sentEmails[0].to).toBe('alice@example.com');
  });

  it('returns failure when user has no email address', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    const res = await channel.send({
      userId: 'user-unknown',
      channel: 'EMAIL',
      event: 'auth.registered',
      body: 'Welcome',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('Recipient email address not found');
    expect(fakeProvider.sentEmails).toHaveLength(0);
  });

  it('links to the dashboard (not a 5-minute signed link) and sends no attachments for invoice.issued', async () => {
    mockTemplateEngine.renderTemplate.mockResolvedValueOnce({
      subject: 'Tax Invoice #BN/2627/000001 Issued',
      body: '<p>Hello Alice, your invoice #BN/2627/000001 has been issued.</p>',
    });

    const res = await channel.send({
      userId: 'user-123',
      channel: 'EMAIL',
      event: 'invoice.issued',
      body: 'fallback body',
      payload: {
        invoiceId: 'f0000000-0000-4000-8000-000000000001',
        customerName: 'Alice',
        invoiceNumber: 'BN/2627/000001',
        total: '4999',
      },
      recipient: { email: 'alice@example.com' },
    });

    expect(res.success).toBe(true);
    expect(fakeProvider.sentEmails).toHaveLength(1);
    const sent = fakeProvider.sentEmails[0];
    expect(sent.html).toContain('/dashboard');
    expect(sent.html).toContain('Download Invoice');
    // Ensure no big attachments are sent (SendEmailOptions has no attachments array)
    expect((sent as unknown as Record<string, unknown>).attachments).toBeUndefined();
  });

  it('never logs email addresses', async () => {
    const loggerSpy = jest.spyOn((channel as unknown as { logger: { log: jest.Mock } }).logger, 'log');

    await channel.send({
      userId: 'user-123',
      channel: 'EMAIL',
      event: 'payment.succeeded',
      body: 'fallback',
      recipient: { email: 'supersecret_personal_email@example.com' },
    });

    for (const call of loggerSpy.mock.calls) {
      const logged = call.join(' ');
      expect(logged).not.toContain('supersecret_personal_email@example.com');
      expect(logged).not.toContain('@example.com');
    }
    loggerSpy.mockRestore();
  });

  describe('Providers', () => {
    it('FakeEmailProvider stores sent emails and can clear them', async () => {
      const fake = new FakeEmailProvider();
      await fake.sendEmail({ to: 'test@example.com', subject: 'Sub', html: '<p>Hi</p>' });
      expect(fake.sentEmails).toHaveLength(1);
      fake.clear();
      expect(fake.sentEmails).toHaveLength(0);
    });

    it('SendGridEmailProvider sends via fetch and parses messageId', async () => {
      const sg = new SendGridEmailProvider({ apiKey: 'sg-test-key', defaultFrom: 'noreply@biznexa.com' });
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 202,
        headers: new Headers({ 'x-message-id': 'sg-msg-123' }),
      } as Response);

      const res = await sg.sendEmail({ to: 'customer@example.com', subject: 'Hi', html: '<b>Hello</b>' });
      expect(res.messageId).toBe('sg-msg-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      global.fetch = originalFetch;
    });
  });
});
