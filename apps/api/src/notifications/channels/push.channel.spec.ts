import { PushChannel } from './push.channel';
import { FakeFcmProvider, RealFcmProvider } from '../providers/fcm.provider';
import type { TemplateEngineService } from '../template-engine.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('PushChannel & FCM Provider (M6.6)', () => {
  let fakeProvider: FakeFcmProvider;
  let mockTemplateEngine: {
    renderTemplate: jest.Mock;
    render: jest.Mock;
  };
  let mockPrisma: {
    deviceToken: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let channel: PushChannel;

  beforeEach(() => {
    fakeProvider = new FakeFcmProvider();
    mockTemplateEngine = {
      renderTemplate: jest.fn().mockResolvedValue({
        subject: 'Application Approved',
        body: 'Your application has been approved successfully.',
      }),
      render: jest.fn(),
    };
    mockPrisma = {
      deviceToken: {
        findMany: jest.fn().mockResolvedValue([
          { token: 'token-active-1' },
          { token: 'token-active-2' },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    channel = new PushChannel(
      fakeProvider,
      mockTemplateEngine as unknown as TemplateEngineService,
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('Push notification delivery', () => {
    it('sends push to all registered tokens with deep-link payload', async () => {
      const result = await channel.send({
        userId: 'user-123',
        event: 'application.approved',
        channel: 'PUSH',
        body: 'Fallback body',
        link: '/dashboard/applications/app-1',
        payload: { applicationId: 'app-1', step: 'review' },
      });

      expect(result.success).toBe(true);
      expect(fakeProvider.sentMessages).toHaveLength(2);
      expect(fakeProvider.sentMessages[0]).toEqual({
        token: 'token-active-1',
        title: 'Application Approved',
        body: 'Your application has been approved successfully.',
        data: {
          event: 'application.approved',
          link: '/dashboard/applications/app-1',
          url: '/dashboard/applications/app-1',
          click_action: '/dashboard/applications/app-1',
          userId: 'user-123',
          applicationId: 'app-1',
          step: 'review',
        },
      });
    });

    it('skips sending gracefully when user has no registered device tokens', async () => {
      mockPrisma.deviceToken.findMany.mockResolvedValueOnce([]);

      const result = await channel.send({
        userId: 'user-no-tokens',
        event: 'application.approved',
        channel: 'PUSH',
        body: 'Fallback body',
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(fakeProvider.sentMessages).toHaveLength(0);
    });

    it('sends to direct pushToken recipient if provided', async () => {
      mockPrisma.deviceToken.findMany.mockResolvedValueOnce([]);

      const result = await channel.send({
        userId: 'user-1',
        event: 'auth.alert',
        channel: 'PUSH',
        body: 'Direct token alert',
        recipient: { pushToken: 'direct-token-xyz' },
      });

      expect(result.success).toBe(true);
      expect(fakeProvider.sentMessages).toHaveLength(1);
      expect(fakeProvider.sentMessages[0].token).toBe('direct-token-xyz');
    });
  });

  describe('Unregistered token cleanup', () => {
    it('deletes token from DB when FCM returns unregistered error', async () => {
      mockPrisma.deviceToken.findMany.mockResolvedValueOnce([
        { token: 'token-valid' },
        { token: 'unregistered-token-404' },
      ]);

      const result = await channel.send({
        userId: 'user-123',
        event: 'application.status_changed',
        channel: 'PUSH',
        body: 'Status changed',
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'unregistered-token-404' },
      });
      expect(mockPrisma.deviceToken.deleteMany).not.toHaveBeenCalledWith({
        where: { token: 'token-valid' },
      });
    });

    it('deletes token marked via markTokenUnregistered', async () => {
      fakeProvider.markTokenUnregistered('token-active-1');

      await channel.send({
        userId: 'user-123',
        event: 'test.event',
        channel: 'PUSH',
        body: 'Testing unregistered cleanup',
      });

      expect(mockPrisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'token-active-1' },
      });
    });
  });

  describe('RealFcmProvider', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('sends HTTP v1 request and returns messageId on success', async () => {
      const provider = new RealFcmProvider('test-project-123', 'fake-jwt-token');
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'projects/test-project-123/messages/msg-789' }),
      });

      const res = await provider.send({
        token: 'dev-token',
        title: 'Hello',
        body: 'World',
        data: { link: '/dashboard' },
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('projects/test-project-123/messages/msg-789');
    });

    it('detects unregistered token on 404 UNREGISTERED response', async () => {
      const provider = new RealFcmProvider('test-project-123', 'fake-jwt-token');
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({
          error: {
            code: 404,
            message: 'Requested entity was not found.',
            status: 'NOT_FOUND',
            details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }],
          },
        }),
      });

      const res = await provider.send({
        token: 'expired-token',
        title: 'Hello',
        body: 'World',
      });

      expect(res.success).toBe(false);
      expect(res.unregistered).toBe(true);
    });
  });
});
