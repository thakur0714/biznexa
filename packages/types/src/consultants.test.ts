import { describe, expect, it } from 'vitest';
import { consultantApplicationInputSchema, publicConsultantDirectoryQuerySchema } from './consultants';

describe('consultant schemas', () => {
  it('validates onboarding profile fields and requires all three proof documents', () => {
    const parsed = consultantApplicationInputSchema.safeParse({
      category: 'CA', qualification: 'Chartered Accountant', experienceYears: 5,
      expertise: ['GST'], languages: ['English'], city: 'Pune', state: 'Maharashtra',
      feePerSession: 150_000, consultationTypes: ['AUDIO'],
      documents: {
        qualificationProofId: '11111111-1111-4111-8111-111111111111',
        membershipProofId: '22222222-2222-4222-8222-222222222222',
        idProofId: '33333333-3333-4333-8333-333333333333',
      },
    });
    expect(parsed.success).toBe(true);
    expect(consultantApplicationInputSchema.safeParse({ category: 'CA', documents: {} }).success).toBe(false);
  });

  it('parses directory filters, explicit false and pagination defaults', () => {
    expect(publicConsultantDirectoryQuerySchema.parse({ availableToday: 'false', minFee: '1000' })).toMatchObject({
      availableToday: false, minFee: 1000, sort: 'rating', page: 1, limit: 12,
    });
  });

  it('rejects inverted fee ranges and invalid rating bounds', () => {
    expect(publicConsultantDirectoryQuerySchema.safeParse({ minFee: '2000', maxFee: '1000' }).success).toBe(false);
    expect(publicConsultantDirectoryQuerySchema.safeParse({ minRating: '6' }).success).toBe(false);
  });
});
