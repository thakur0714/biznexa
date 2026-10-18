import { z } from 'zod';

export const reviewModerationStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const reviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000).optional(),
}).strict();
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const reviewViewSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  text: z.string().nullable(),
  status: z.enum(reviewModerationStatuses),
  moderationReason: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ReviewView = z.infer<typeof reviewViewSchema>;
export const customerReviewSchema = reviewViewSchema.nullable();

export const adminReviewQuerySchema = z.object({
  status: z.enum(reviewModerationStatuses).default('PENDING'),
});
export type AdminReviewQuery = z.infer<typeof adminReviewQuerySchema>;

export const adminReviewSchema = reviewViewSchema.extend({
  bookingCode: z.string(),
  customerName: z.string(),
  consultantName: z.string(),
});
export const adminReviewListSchema = z.object({ items: z.array(adminReviewSchema) });
export type AdminReview = z.infer<typeof adminReviewSchema>;
export type AdminReviewList = z.infer<typeof adminReviewListSchema>;

export const reviewModerationInputSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().max(1000).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.status === 'REJECTED' && (!input.reason || input.reason.length < 3)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Give a reason of at least 3 characters when rejecting a review.' });
  }
});
export type ReviewModerationInput = z.infer<typeof reviewModerationInputSchema>;
