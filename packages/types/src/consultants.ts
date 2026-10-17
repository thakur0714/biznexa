import { z } from 'zod';

export const consultantCategories = [
  'CA',
  'CS',
  'LAWYER',
  'TAX_CONSULTANT',
  'TRADEMARK_CONSULTANT',
  'ISO_CONSULTANT',
  'BUSINESS_CONSULTANT',
  'TECHNOLOGY_CONSULTANT',
] as const;

export const consultationTypes = ['AUDIO', 'VIDEO', 'CHAT', 'MEETING'] as const;

export const consultantDocumentKinds = ['QUALIFICATION_PROOF', 'MEMBERSHIP_PROOF', 'ID_PROOF'] as const;
export type ConsultantCategory = (typeof consultantCategories)[number];
export type ConsultationType = (typeof consultationTypes)[number];

const cleanString = (label: string, max: number) => z.string().trim().min(1, `${label} is required`).max(max);

export const consultantProfileInputSchema = z.object({
  category: z.enum(consultantCategories),
  qualification: cleanString('Qualification', 120),
  membershipNo: z.string().trim().max(80).nullable().optional(),
  experienceYears: z.number().int().min(0).max(60),
  expertise: z.array(cleanString('Expertise', 80)).min(1).max(20),
  languages: z.array(cleanString('Language', 40)).min(1).max(20),
  city: cleanString('City', 100),
  state: cleanString('State', 100),
  area: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(2_000).nullable().optional(),
  feePerSession: z.number().int().min(1).max(100_000_000).describe('Consultation fee in paise'),
  consultationTypes: z.array(z.enum(consultationTypes)).min(1),
}).strict();

export const consultantApplicationInputSchema = consultantProfileInputSchema.extend({
  documents: z.object({
    qualificationProofId: z.string().uuid(),
    membershipProofId: z.string().uuid(),
    idProofId: z.string().uuid(),
  }).strict(),
}).strict();

export type ConsultantProfileInput = z.infer<typeof consultantProfileInputSchema>;
export type ConsultantApplicationInput = z.infer<typeof consultantApplicationInputSchema>;

export const consultantApplicationResponseSchema = z.object({
  id: z.string().uuid(),
  verificationStatus: z.literal('PENDING'),
});

export type ConsultantApplicationResponse = z.infer<typeof consultantApplicationResponseSchema>;
