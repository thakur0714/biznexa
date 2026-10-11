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
