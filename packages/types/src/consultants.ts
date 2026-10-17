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
export const consultantCategorySchema = z.enum(consultantCategories);
export const consultationTypeSchema = z.enum(consultationTypes);
export const consultantDocumentKindSchema = z.enum(consultantDocumentKinds);
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

export const consultantVerificationStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type ConsultantVerificationStatus = (typeof consultantVerificationStatuses)[number];

export const adminConsultantListQuerySchema = z.object({
  status: z.enum(consultantVerificationStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminConsultantListQuery = z.infer<typeof adminConsultantListQuerySchema>;

export const adminConsultantSummarySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  category: consultantCategorySchema,
  verificationStatus: z.enum(consultantVerificationStatuses),
  city: z.string(),
  state: z.string(),
  experienceYears: z.number().int(),
  feePerSession: z.number().int(),
  createdAt: z.string().datetime(),
});
export type AdminConsultantSummary = z.infer<typeof adminConsultantSummarySchema>;

export const adminConsultantDocumentSchema = z.object({
  id: z.string().uuid(),
  kind: consultantDocumentKindSchema,
  fileId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  scanStatus: z.enum(['PENDING', 'CLEAN', 'INFECTED']),
  createdAt: z.string().datetime(),
});

export const adminConsultantDetailSchema = adminConsultantSummarySchema.extend({
  slug: z.string(),
  qualification: z.string(),
  membershipNo: z.string().nullable(),
  expertise: z.array(z.string()),
  languages: z.array(z.string()),
  area: z.string().nullable(),
  bio: z.string().nullable(),
  consultationTypes: z.array(consultationTypeSchema),
  rejectionReason: z.string().nullable(),
  updatedAt: z.string().datetime(),
  documents: z.array(adminConsultantDocumentSchema),
  feeChangeRequests: z.array(z.object({
    id: z.string().uuid(),
    requestedFee: z.number().int(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    decisionReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    decidedAt: z.string().datetime().nullable(),
    decidedBy: z.string().nullable(),
  })),
});
export type AdminConsultantDetail = z.infer<typeof adminConsultantDetailSchema>;

export const adminConsultantListSchema = z.object({
  items: z.array(adminConsultantSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminConsultantList = z.infer<typeof adminConsultantListSchema>;

export const adminConsultantProfileInputSchema = consultantProfileInputSchema;
export type AdminConsultantProfileInput = z.infer<typeof adminConsultantProfileInputSchema>;
export const consultantFeeChangeStatus = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const consultantFeeChangeRequestSchema = z.object({
  id: z.string().uuid(),
  consultantId: z.string().uuid(),
  requestedFee: z.number().int(),
  status: z.enum(consultantFeeChangeStatus),
  decisionReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});
export type ConsultantFeeChangeRequest = z.infer<typeof consultantFeeChangeRequestSchema>;
export const consultantOwnProfileSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  category: consultantCategorySchema,
  qualification: z.string(),
  membershipNo: z.string().nullable(),
  experienceYears: z.number().int(),
  expertise: z.array(z.string()),
  languages: z.array(z.string()),
  city: z.string(),
  state: z.string(),
  area: z.string().nullable(),
  bio: z.string().nullable(),
  feePerSession: z.number().int(),
  consultationTypes: z.array(consultationTypeSchema),
  pendingFeeRequest: consultantFeeChangeRequestSchema.nullable(),
});
export type ConsultantOwnProfile = z.infer<typeof consultantOwnProfileSchema>;
export const consultantFeeChangeDecisionSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export type ConsultantFeeChangeDecision = z.infer<typeof consultantFeeChangeDecisionSchema>;
export const consultantFeeChangeActionResponseSchema = z.object({
  id: z.string().uuid(), consultantId: z.string().uuid(), requestedFee: z.number().int(), status: z.enum(['APPROVED', 'REJECTED']), decisionReason: z.string().nullable(),
});
export type ConsultantFeeChangeActionResponse = z.infer<typeof consultantFeeChangeActionResponseSchema>;
export const consultantRejectInputSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export type ConsultantRejectInput = z.infer<typeof consultantRejectInputSchema>;

export const adminConsultantActionResponseSchema = z.object({
  id: z.string().uuid(),
  verificationStatus: z.enum(consultantVerificationStatuses),
});
export type AdminConsultantActionResponse = z.infer<typeof adminConsultantActionResponseSchema>;

export const publicConsultantDirectoryQuerySchema = z.object({
  category: z.enum(consultantCategories).optional(),
  state: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  area: z.string().trim().min(1).max(120).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minExperience: z.coerce.number().int().min(0).max(60).optional(),
  minFee: z.coerce.number().int().min(0).max(100_000_000).optional().describe('Minimum session fee in paise'),
  maxFee: z.coerce.number().int().min(0).max(100_000_000).optional().describe('Maximum session fee in paise'),
  language: z.string().trim().min(1).max(40).optional(),
  consultationType: z.enum(consultationTypes).optional(),
  availableToday: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum(['rating', 'experience', 'fee_low', 'fee_high']).default('rating'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
}).refine((query) => query.minFee === undefined || query.maxFee === undefined || query.minFee <= query.maxFee, {
  message: 'Minimum fee must not exceed maximum fee', path: ['minFee'],
});
export type PublicConsultantDirectoryQuery = z.infer<typeof publicConsultantDirectoryQuerySchema>;

export const publicConsultantCardSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  category: consultantCategorySchema,
  qualification: z.string(),
  city: z.string(),
  state: z.string(),
  area: z.string().nullable(),
  expertise: z.array(z.string()),
  languages: z.array(z.string()),
  bio: z.string().nullable(),
  photoUrl: z.string().nullable(),
  feePerSession: z.number().int().describe('Consultation fee in paise'),
  sessionMinutes: z.number().int(),
  consultationTypes: z.array(consultationTypeSchema),
  rating: z.number(),
  reviewCount: z.number().int(),
  isOnline: z.boolean(),
  availableToday: z.boolean(),
});
export type PublicConsultantCard = z.infer<typeof publicConsultantCardSchema>;

export const publicConsultantDirectorySchema = z.object({
  items: z.array(publicConsultantCardSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type PublicConsultantDirectory = z.infer<typeof publicConsultantDirectorySchema>;

export const publicConsultantProfileSchema = publicConsultantCardSchema.omit({ availableToday: true }).extend({
  experienceYears: z.number().int(),
  ratingSummary: z.object({
    average: z.number(),
    reviewCount: z.number().int(),
    breakdown: z.object({ '1': z.number().int(), '2': z.number().int(), '3': z.number().int(), '4': z.number().int(), '5': z.number().int() }),
  }),
  services: z.array(z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), category: z.string() })),
  verifiedReviews: z.array(z.object({ id: z.string().uuid(), rating: z.number().int().min(1).max(5), text: z.string().nullable(), createdAt: z.string().datetime() })),
});
export type PublicConsultantProfile = z.infer<typeof publicConsultantProfileSchema>;
