import { SmsChannel } from './sms.channel';
import { FakeSmsProvider, Msg91SmsProvider, maskMobile } from '../providers/sms.provider';
import type { TemplateEngineService } from '../template-engine.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ChannelOtpSender } from '../../auth/otp-sender';
import type { EmailChannel } from './email.channel';

describe('SmsChannel & MSG91 Provider (M6.5)', () => {
  let fakeProvider: FakeSmsProvider;
  let mockTemplateEngine: {
    renderTemplate: jest.Mock;
    render: jest.Mock;
  };
  let mockPrisma: {
    user: {
      findUnique: jest.Mock;
    };
    notificationTemplate: {
      findUnique: jest.Mock;
    };
  };
  let channel: SmsChannel;

  beforeEach(() => {
    fakeProvider = new FakeSmsProvider();
    mockTemplateEngine = {
      renderTemplate: jest.fn().mockResolvedValue({
        body: '123456 is your BizNexa verification code. Valid for 5 minutes.',
      }),
      render: jest.fn(),
    };
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ mobile: '9876543210' }),
      },
      notificationTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          event: 'auth.otp',
          channel: 'SMS',
          dltTemplateId: 'DLT-120716179644',
          body: '{{otp}} is your BizNexa code.',
          isActive: true,
        }),
      },
    };
    channel = new SmsChannel(
      fakeProvider,
      mockTemplateEngine as unknown as TemplateEngineService,
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('DLT Template Enforcement', () => {
    it('refuses to send an SMS template without a DLT id with clear error', async () => {
      mockPrisma.notificationTemplate.findUnique.mockResolvedValueOnce({
        event: 'payment.succeeded',
        channel: 'SMS',
        dltTemplateId: null, // Missing DLT id
        body: 'Payment received',
      });

      const loggerSpy = jest.spyOn((channel as unknown as { logger: { error: jest.Mock } }).logger, 'error');

      const res = await channel.send({
        userId: 'user-123',
        channel: 'SMS',
        event: 'payment.succeeded',
        body: 'fallback',
        recipient: { mobile: '9876543210' },
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('SMS template for event "payment.succeeded" has no registered DLT template ID');
      expect(fakeProvider.sentSms).toHaveLength(0);

      // Verify that error is logged WITHOUT the mobile number
      expect(loggerSpy).toHaveBeenCalled();
      for (const call of loggerSpy.mock.calls) {
        const logged = call.join(' ');
        expect(logged).not.toContain('9876543210');
      }
      loggerSpy.mockRestore();
    });

    it('sends SMS when template has DLT template ID from NotificationTemplate', async () => {
      const res = await channel.send({
        userId: 'user-123',
        channel: 'SMS',
        event: 'auth.otp',
        body: 'fallback',
        payload: { otp: '654321' },
        recipient: { mobile: '9876543210' },
      });

      expect(res.success).toBe(true);
      expect(fakeProvider.sentSms).toHaveLength(1);
      const sent = fakeProvider.sentSms[0];
      expect(sent.to).toBe('9876543210');
      expect(sent.dltTemplateId).toBe('DLT-120716179644');
      expect(sent.otp).toBe('654321');
    });
  });

  describe('Masked mobile in dev/test logs', () => {
    it('masks mobile numbers correctly', () => {
      expect(maskMobile('9876543210')).toBe('98******10');
      expect(maskMobile('+91 9876543210')).toBe('91******10');
      expect(maskMobile('123')).toBe('****');
    });

    it('logs only the masked mobile in FakeSmsProvider', async () => {
      const loggerSpy = jest.spyOn((fakeProvider as unknown as { logger: { log: jest.Mock } }).logger, 'log');

      await fakeProvider.sendSms({
        to: '9876543210',
        message: 'Hello',
        dltTemplateId: 'DLT-001',
      });

      expect(loggerSpy).toHaveBeenCalled();
      for (const call of loggerSpy.mock.calls) {
        const logged = call.join(' ');
        expect(logged).toContain('98******10');
        expect(logged).not.toContain('9876543210');
      }
      loggerSpy.mockRestore();
    });
  });

  describe('MSG91 Provider', () => {
    it('sends OTP via MSG91 OTP endpoint', async () => {
      const msg91 = new Msg91SmsProvider({ authKey: 'test-auth-key' });
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"type":"success"}',
      } as Response);

      const res = await msg91.sendSms({
        to: '9876543210',
        message: 'OTP 123456',
        dltTemplateId: 'DLT-OTP-1',
        otp: '123456',
      });

      expect(res.messageId).toBeDefined();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = (global.fetch as jest.Mock).mock.calls[0][0].toString();
      expect(url).toContain('https://control.msg91.com/api/v5/otp');
      expect(url).toContain('template_id=DLT-OTP-1');
      expect(url).toContain('mobile=919876543210');
      expect(url).toContain('otp=123456');

      global.fetch = originalFetch;
    });

    it('sends regular SMS via MSG91 Flow endpoint', async () => {
      const msg91 = new Msg91SmsProvider({ authKey: 'test-auth-key' });
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"type":"success","message":"3561646b6a71353030303031"}',
      } as Response);

      const res = await msg91.sendSms({
        to: '9876543210',
        message: 'Hello flow',
        dltTemplateId: 'DLT-FLOW-1',
        variables: { var1: 'val1' },
      });

      // The request id comes back in MSG91's delivery report (M6.3).
      expect(res.messageId).toBe('3561646b6a71353030303031');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://control.msg91.com/api/v5/flow/');
      const body = JSON.parse(opts.body);
      expect(body.template_id).toBe('DLT-FLOW-1');
      expect(body.recipients[0].mobiles).toBe('919876543210');

      global.fetch = originalFetch;
    });
  });

  describe('ChannelOtpSender', () => {
    it('delegates MOBILE OTP to SmsChannel and EMAIL OTP to EmailChannel', async () => {
      const mockSmsChannel = {
        send: jest.fn().mockResolvedValue({ success: true }),
      };
      const mockEmailChannel = {
        send: jest.fn().mockResolvedValue({ success: true }),
      };

      const otpSender = new ChannelOtpSender(
        mockSmsChannel as unknown as SmsChannel,
        mockEmailChannel as unknown as EmailChannel,
      );

      await otpSender.send('MOBILE', '9876543210', '123456', 'LOGIN');
      expect(mockSmsChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'SMS',
          event: 'auth.otp',
          recipient: { mobile: '9876543210' },
          payload: { otp: '123456', purpose: 'LOGIN', validMinutes: '5' },
        }),
      );

      await otpSender.send('EMAIL', 'alice@example.com', '654321', 'RESET_PASSWORD');
      expect(mockEmailChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          event: 'auth.otp',
          recipient: { email: 'alice@example.com' },
          payload: { otp: '654321', purpose: 'RESET_PASSWORD', validMinutes: '5' },
        }),
      );
    });
  });
});
