import { describe, it, expect } from 'vitest';
import {
  mobileSchema,
  loginSchema,
  registerSchema,
  otpVerifySchema,
} from '@biznexa/types';

describe('Mobile Auth Validation using @biznexa/types', () => {
  it('validates Indian 10-digit mobile numbers', () => {
    expect(mobileSchema.safeParse('9876543210').success).toBe(true);
    expect(mobileSchema.safeParse('8123456789').success).toBe(true);
    expect(mobileSchema.safeParse('7000000000').success).toBe(true);
    expect(mobileSchema.safeParse('6999999999').success).toBe(true);

    // Invalid mobile numbers
    expect(mobileSchema.safeParse('5876543210').success).toBe(false);
    expect(mobileSchema.safeParse('987654321').success).toBe(false);
    expect(mobileSchema.safeParse('98765432100').success).toBe(false);
    expect(mobileSchema.safeParse('abcdefghij').success).toBe(false);
  });

  it('validates password login payload', () => {
    const valid = loginSchema.safeParse({
      email: 'founder@startup.in',
      password: 'password123',
    });
    expect(valid.success).toBe(true);

    const invalidEmail = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    });
    expect(invalidEmail.success).toBe(false);
  });

  it('validates registration payload with password rules and consent', () => {
    const valid = registerSchema.safeParse({
      name: 'Rohan Sharma',
      mobile: '9876543210',
      email: 'rohan@example.com',
      password: 'SecurePassword123',
      consent: true,
    });
    expect(valid.success).toBe(true);

    // Without number in password
    const noNumber = registerSchema.safeParse({
      name: 'Rohan Sharma',
      mobile: '9876543210',
      email: 'rohan@example.com',
      password: 'SecurePassword',
      consent: true,
    });
    expect(noNumber.success).toBe(false);

    // Without consent
    const noConsent = registerSchema.safeParse({
      name: 'Rohan Sharma',
      mobile: '9876543210',
      email: 'rohan@example.com',
      password: 'SecurePassword123',
      consent: false,
    });
    expect(noConsent.success).toBe(false);
  });

  it('validates OTP verification code format', () => {
    const valid = otpVerifySchema.safeParse({
      channel: 'MOBILE',
      target: '9876543210',
      code: '123456',
      purpose: 'LOGIN',
    });
    expect(valid.success).toBe(true);

    const shortCode = otpVerifySchema.safeParse({
      channel: 'MOBILE',
      target: '9876543210',
      code: '12345',
      purpose: 'LOGIN',
    });
    expect(shortCode.success).toBe(false);
  });
});
