import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { AdminReviewList, AdminReviewQuery, ReviewInput, ReviewModerationInput, ReviewView } from '@biznexa/types';
import { adminReviewListSchema, reviewViewSchema } from '@biznexa/types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async submit(customerId: string, bookingId: string, input: ReviewInput): Promise<ReviewView> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      select: { id: true, consultantId: true, status: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'COMPLETED') throw new ConflictException('You can leave a review after the consultation is completed.');
    try {
      const review = await this.prisma.review.create({
        data: { bookingId, consultantId: booking.consultantId, rating: input.rating, text: input.text?.trim() || null },
        select: { id: true, bookingId: true, rating: true, text: true, status: true, moderationReason: true, createdAt: true },
      });
      return reviewViewSchema.parse({ ...review, createdAt: review.createdAt.toISOString() });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A review has already been submitted for this consultation.');
      }
      throw error;
    }
  }

  async getMine(customerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, customerId }, select: { id: true } });
    if (!booking) throw new NotFoundException('Booking not found');
    const review = await this.prisma.review.findUnique({
      where: { bookingId },
      select: { id: true, bookingId: true, rating: true, text: true, status: true, moderationReason: true, createdAt: true },
    });
    return review ? reviewViewSchema.parse({ ...review, createdAt: review.createdAt.toISOString() }) : null;
  }

  async listAdmin(query: AdminReviewQuery): Promise<AdminReviewList> {
    const { page, pageSize } = query;
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { status: query.status },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, bookingId: true, rating: true, text: true, status: true, moderationReason: true, createdAt: true,
          booking: { select: { code: true, customer: { select: { name: true } } } },
          consultant: { select: { user: { select: { name: true } } } },
        },
      }),
      this.prisma.review.count({ where: { status: query.status } }),
    ]);
    return adminReviewListSchema.parse({
      items: items.map(({ booking, consultant, ...item }) => ({
        ...item,
        bookingCode: booking.code,
        customerName: booking.customer.name,
        consultantName: consultant.user.name,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize),
    });
  }

  async moderate(reviewId: string, staffId: string, input: ReviewModerationInput): Promise<ReviewView> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Review" WHERE id = ${reviewId} FOR UPDATE`;
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: { id: true, bookingId: true, consultantId: true, rating: true, text: true, status: true, moderationReason: true, createdAt: true, isPublished: true },
      });
      if (!review) throw new NotFoundException('Review not found');
      if (review.status !== 'PENDING') throw new ConflictException('This review has already been moderated.');
      // Serialize approvals for the same consultant so concurrent aggregates cannot overwrite each other.
      await tx.$queryRaw`SELECT id FROM "Consultant" WHERE id = ${review.consultantId} FOR UPDATE`;
      const updated = await tx.review.update({
        where: { id: reviewId },
        data: {
          status: input.status,
          isPublished: input.status === 'APPROVED',
          moderationReason: input.status === 'REJECTED' ? input.reason : null,
          moderatedAt: new Date(),
          moderatedById: staffId,
        },
        select: { id: true, bookingId: true, consultantId: true, rating: true, text: true, status: true, moderationReason: true, createdAt: true },
      });
      const aggregate = await tx.review.aggregate({
        where: { consultantId: review.consultantId, status: 'APPROVED' },
        _avg: { rating: true },
        _count: { _all: true },
      });
      await tx.consultant.update({
        where: { id: review.consultantId },
        data: { rating: aggregate._avg.rating ?? 0, reviewCount: aggregate._count._all },
      });
      await this.audit.log({
        actorId: staffId,
        action: `review.${input.status.toLowerCase()}`,
        entityType: 'Review',
        entityId: reviewId,
        before: { status: review.status, isPublished: review.isPublished, moderationReason: review.moderationReason },
        after: { status: updated.status, isPublished: input.status === 'APPROVED', moderationReason: updated.moderationReason, consultantRating: aggregate._avg.rating ?? 0, consultantReviewCount: aggregate._count._all },
      }, tx);
      return reviewViewSchema.parse({ ...updated, createdAt: updated.createdAt.toISOString() });
    });
  }
}
