/** Zod schemas shared by web forms, mobile and API validation. */
import { z } from 'zod';

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(100),
  mobile: mobileSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: passwordSchema,
  consent: z.literal(true, { errorMap: () => ({ message: 'Please accept the Terms and Privacy Policy' }) }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const otpRequestSchema = z.object({
  channel: z.enum(['MOBILE', 'EMAIL']).default('MOBILE'),
  target: z.string().trim().min(3),
  purpose: z.enum(['LOGIN', 'VERIFY_MOBILE', 'RESET_PASSWORD']),
});

export const otpVerifySchema = z.object({
  channel: z.enum(['MOBILE', 'EMAIL']).default('MOBILE'),
  target: z.string().trim().min(3),
  purpose: z.enum(['LOGIN', 'VERIFY_MOBILE', 'RESET_PASSWORD']),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const verifyCertificateSchema = z
  .object({
    number: z.string().trim().max(64).optional().describe('Certificate number'),
    id: z.string().trim().max(64).optional().describe('Verification ID (printed on the certificate / in the QR code)'),
  })
  .refine((v) => !!(v.number || v.id), 'Enter a certificate number or verification ID');

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(100).optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email').optional(),
  })
  .refine((v) => v.name !== undefined || v.email !== undefined, {
    message: 'Provide at least name or email',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const authMeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  emailVerified: z.boolean(),
  mobileVerified: z.boolean(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  twoFactor: z.object({
    required: z.boolean(),
    enabled: z.boolean(),
    verified: z.boolean(),
  }),
});
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

