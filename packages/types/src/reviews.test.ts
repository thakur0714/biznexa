import { describe, expect, it } from 'vitest';
import { reviewInputSchema, reviewModerationInputSchema } from './reviews';

describe('review schemas', () => {
  it('requires an integer rating from one through five', () => {
    expect(reviewInputSchema.safeParse({ rating: 5 }).success).toBe(true);
    for (const rating of [0, 6, 2.5]) expect(reviewInputSchema.safeParse({ rating }).success).toBe(false);
  });

  it('requires a reason when rejecting and rejects unknown fields', () => {
    expect(reviewModerationInputSchema.safeParse({ status: 'REJECTED' }).success).toBe(false);
    expect(reviewModerationInputSchema.safeParse({ status: 'REJECTED', reason: 'Inappropriate content' }).success).toBe(true);
    expect(reviewModerationInputSchema.safeParse({ status: 'APPROVED', unexpected: true }).success).toBe(false);
  });
});
