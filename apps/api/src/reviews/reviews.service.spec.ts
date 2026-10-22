import { ConflictException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

type MockPrisma = {
  booking: { findFirst: jest.Mock };
  review: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock };
  consultant: { update: jest.Mock };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

describe('ReviewsService', () => {
  const at = new Date('2026-10-18T10:00:00.000Z');
  const bookingId = '11111111-1111-4111-8111-111111111111';
  const reviewId = '22222222-2222-4222-8222-222222222222';
  let service: ReviewsService;
  let prisma: MockPrisma;
  let audit: { log: jest.Mock };

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      booking: { findFirst: jest.fn() },
      review: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
      consultant: { update: jest.fn() },
      $transaction: jest.fn((callback: (tx: MockPrisma) => unknown) => Promise.resolve(callback(prisma))),
      $queryRaw: jest.fn(),
    };
    service = new ReviewsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  });

  it('refuses a review unless the booking belongs to the customer and is completed', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: bookingId, consultantId: 'consultant-1', status: 'CONFIRMED' });
    await expect(service.submit('customer-1', bookingId, { rating: 5 })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('creates a pending review for a completed booking', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: bookingId, consultantId: 'consultant-1', status: 'COMPLETED' });
    prisma.review.create.mockResolvedValue({ id: reviewId, bookingId, rating: 4, text: 'Helpful', status: 'PENDING', moderationReason: null, createdAt: at });
    await expect(service.submit('customer-1', bookingId, { rating: 4, text: ' Helpful ' })).resolves.toMatchObject({ status: 'PENDING', text: 'Helpful' });
  });

  it('updates the consultant aggregate and moderation audit within one transaction', async () => {
    prisma.review.findUnique.mockResolvedValue({ id: reviewId, bookingId, consultantId: 'consultant-1', rating: 4, text: 'Helpful', status: 'PENDING', moderationReason: null, createdAt: at, isPublished: false });
    prisma.review.update.mockResolvedValue({ id: reviewId, bookingId, consultantId: 'consultant-1', rating: 4, text: 'Helpful', status: 'APPROVED', moderationReason: null, createdAt: at });
    prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: { _all: 2 } });
    await expect(service.moderate(reviewId, 'staff-1', { status: 'APPROVED' })).resolves.toMatchObject({ status: 'APPROVED' });
    expect(prisma.consultant.update).toHaveBeenCalledWith({ where: { id: 'consultant-1' }, data: { rating: 4.5, reviewCount: 2 } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'review.approved', entityType: 'Review', entityId: reviewId }), prisma);
  });
});
