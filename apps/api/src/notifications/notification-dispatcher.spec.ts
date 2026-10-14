import {
  NotificationDispatcherService,
  UnknownNotificationChannelError,
} from './notification-dispatcher.service';
import type { NotificationPreferencesService } from './notification-preferences.service';
import type { EmailChannel } from './channels/email.channel';
import type { SmsChannel } from './channels/sms.channel';
import type { PushChannel } from './channels/push.channel';
import type { InAppChannel } from './channels/in-app.channel';
import type { WhatsAppChannel } from './channels/whatsapp.channel';
import type { SendNotificationInput } from '@biznexa/types';

describe('NotificationDispatcherService', () => {
  let dispatcher: NotificationDispatcherService;
  let mockPreferencesService: Partial<NotificationPreferencesService>;
  let mockEmailChannel: { channel: 'EMAIL'; send: jest.Mock };
  let mockSmsChannel: { channel: 'SMS'; send: jest.Mock };
  let mockPushChannel: { channel: 'PUSH'; send: jest.Mock };
  let mockInAppChannel: { channel: 'IN_APP'; send: jest.Mock };
  let mockWhatsAppChannel: { channel: 'WHATSAPP'; send: jest.Mock };

  beforeEach(() => {
    mockPreferencesService = {
      getPreferences: jest.fn().mockResolvedValue({
        marketingOptOut: false,
        channelPreferences: {},
      }),
    };

    mockEmailChannel = {
      channel: 'EMAIL',
      send: jest.fn().mockResolvedValue({ success: true, channel: 'EMAIL' }),
    };

    mockSmsChannel = {
      channel: 'SMS',
      send: jest.fn().mockResolvedValue({ success: true, channel: 'SMS' }),
    };

    mockPushChannel = {
      channel: 'PUSH',
      send: jest.fn().mockResolvedValue({ success: true, channel: 'PUSH' }),
    };

    mockInAppChannel = {
      channel: 'IN_APP',
      send: jest.fn().mockResolvedValue({ success: true, channel: 'IN_APP', notificationId: 'notif-1' }),
    };

    mockWhatsAppChannel = {
      channel: 'WHATSAPP',
      send: jest.fn().mockResolvedValue({ success: true, channel: 'WHATSAPP' }),
    };

    dispatcher = new NotificationDispatcherService(
      mockPreferencesService as NotificationPreferencesService,
      mockEmailChannel as unknown as EmailChannel,
      mockSmsChannel as unknown as SmsChannel,
      mockPushChannel as unknown as PushChannel,
      mockInAppChannel as unknown as InAppChannel,
      mockWhatsAppChannel as unknown as WhatsAppChannel,
    );
  });

  describe('unknown channel', () => {
    it('throws UnknownNotificationChannelError when dispatching to an unregistered channel', async () => {
      const input = {
        userId: 'user-1',
        event: 'order.placed',
        channel: 'CARRIER_PIGEON' as any,
        body: 'Your order was placed',
      };

      await expect(dispatcher.dispatch(input)).rejects.toThrow(UnknownNotificationChannelError);
      await expect(dispatcher.dispatch(input)).rejects.toThrow('Unknown notification channel: CARRIER_PIGEON');
    });
  });

  describe('marketing vs transactional and opt-out', () => {
    it('skips marketing notifications when user opted out of marketing', async () => {
      mockPreferencesService.getPreferences = jest.fn().mockResolvedValue({
        marketingOptOut: true,
        channelPreferences: {},
      });

      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'marketing.promo',
        channel: 'EMAIL',
        category: 'MARKETING',
        title: '50% off on GST filing',
        body: 'Special offer this festive season!',
      };

      const result = await dispatcher.dispatch(input);

      expect(result).toEqual({
        success: true,
        channel: 'EMAIL',
        skipped: true,
        reason: 'opted_out',
      });
      expect(mockEmailChannel.send).not.toHaveBeenCalled();
    });

    it('skips marketing notifications when user disabled that specific channel', async () => {
      mockPreferencesService.getPreferences = jest.fn().mockResolvedValue({
        marketingOptOut: false,
        channelPreferences: { EMAIL: false },
      });

      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'marketing.promo',
        channel: 'EMAIL',
        category: 'MARKETING',
        title: 'New Service Launched',
        body: 'Check out our new trademark service',
      };

      const result = await dispatcher.dispatch(input);

      expect(result).toEqual({
        success: true,
        channel: 'EMAIL',
        skipped: true,
        reason: 'channel_opted_out',
      });
      expect(mockEmailChannel.send).not.toHaveBeenCalled();
    });

    it('delivers marketing notification when user has not opted out', async () => {
      mockPreferencesService.getPreferences = jest.fn().mockResolvedValue({
        marketingOptOut: false,
        channelPreferences: { EMAIL: true },
      });

      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'marketing.newsletter',
        channel: 'EMAIL',
        category: 'MARKETING',
        title: 'Monthly Business Insights',
        body: 'Top compliance updates this month',
      };

      const result = await dispatcher.dispatch(input);

      expect(result).toEqual({ success: true, channel: 'EMAIL' });
      expect(mockEmailChannel.send).toHaveBeenCalledWith(input);
    });

    it('always sends transactional notification even if user opted out of marketing', async () => {
      mockPreferencesService.getPreferences = jest.fn().mockResolvedValue({
        marketingOptOut: true,
        channelPreferences: { EMAIL: false, SMS: false },
      });

      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'payment.succeeded',
        channel: 'EMAIL',
        category: 'TRANSACTIONAL',
        title: 'Payment Received',
        body: 'Your payment of Rs 5000 was successful',
      };

      const result = await dispatcher.dispatch(input);

      expect(result).toEqual({ success: true, channel: 'EMAIL' });
      expect(mockEmailChannel.send).toHaveBeenCalledWith(input);
    });

    it('defaults category to TRANSACTIONAL and sends even if user opted out of marketing', async () => {
      mockPreferencesService.getPreferences = jest.fn().mockResolvedValue({
        marketingOptOut: true,
        channelPreferences: {},
      });

      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'auth.otp',
        channel: 'SMS',
        // no category specified -> defaults to TRANSACTIONAL
        body: 'Your OTP is 123456',
      };

      const result = await dispatcher.dispatch(input);

      expect(result).toEqual({ success: true, channel: 'SMS' });
      expect(mockSmsChannel.send).toHaveBeenCalledWith(input);
    });
  });

  describe('channel routing', () => {
    it('routes push notifications to PushChannel', async () => {
      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'document.requested',
        channel: 'PUSH',
        body: 'Please upload address proof',
      };

      const result = await dispatcher.dispatch(input);
      expect(result).toEqual({ success: true, channel: 'PUSH' });
      expect(mockPushChannel.send).toHaveBeenCalledWith(input);
    });

    it('routes in-app notifications to InAppChannel', async () => {
      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'certificate.issued',
        channel: 'IN_APP',
        body: 'Your ISO certificate has been issued',
      };

      const result = await dispatcher.dispatch(input);
      expect(result).toEqual({ success: true, channel: 'IN_APP', notificationId: 'notif-1' });
      expect(mockInAppChannel.send).toHaveBeenCalledWith(input);
    });

    it('routes whatsapp notifications to WhatsAppChannel', async () => {
      const input: SendNotificationInput = {
        userId: 'user-1',
        event: 'ticket.replied',
        channel: 'WHATSAPP',
        body: 'Support has replied to your ticket',
      };

      const result = await dispatcher.dispatch(input);
      expect(result).toEqual({ success: true, channel: 'WHATSAPP' });
      expect(mockWhatsAppChannel.send).toHaveBeenCalledWith(input);
    });
  });
});
