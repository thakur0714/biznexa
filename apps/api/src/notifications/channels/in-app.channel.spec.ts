import { InAppChannel } from './in-app.channel';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SendNotificationInput } from '@biznexa/types';

describe('InAppChannel', () => {
  let channel: InAppChannel;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      notification: {
        create: jest.fn(),
      },
    };
    channel = new InAppChannel(mockPrisma as PrismaService);
  });

  it('writes a Notification row to the database', async () => {
    mockPrisma.notification.create.mockResolvedValue({
      id: 'notif-123',
      userId: 'user-456',
      channel: 'IN_APP',
      event: 'document.approved',
      title: 'Document Approved',
      body: 'Your PAN card was verified',
      link: '/applications/app-1',
      payload: { docId: 'doc-789' },
      status: 'DELIVERED',
    });

    const input: SendNotificationInput = {
      userId: 'user-456',
      event: 'document.approved',
      channel: 'IN_APP',
      title: 'Document Approved',
      body: 'Your PAN card was verified',
      link: '/applications/app-1',
      payload: { docId: 'doc-789' },
    };

    const res = await channel.send(input);

    expect(res).toEqual({
      success: true,
      channel: 'IN_APP',
      notificationId: 'notif-123',
    });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-456',
        channel: 'IN_APP',
        event: 'document.approved',
        title: 'Document Approved',
        body: 'Your PAN card was verified',
        link: '/applications/app-1',
        payload: { docId: 'doc-789' },
        status: 'DELIVERED',
      },
    });
  });

  it('handles database error gracefully', async () => {
    mockPrisma.notification.create.mockRejectedValue(new Error('DB connection failed'));

    const input: SendNotificationInput = {
      userId: 'user-456',
      event: 'document.approved',
      channel: 'IN_APP',
      body: 'Your PAN card was verified',
    };

    const res = await channel.send(input);

    expect(res.success).toBe(false);
    expect(res.channel).toBe('IN_APP');
    expect(res.error).toBe('DB connection failed');
  });
});
