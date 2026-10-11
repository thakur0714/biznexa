import { describe, expect, it } from 'vitest';
import { PERMS, needsTwoFactor, requiresTwoFactor, totpCodeSchema } from './index';

describe('totpCodeSchema', () => {
  it('accepts six digits, ignoring spaces the user typed', () => {
    expect(totpCodeSchema.parse({ code: '123456' }).code).toBe('123456');
    expect(totpCodeSchema.parse({ code: ' 123 456 ' }).code).toBe('123456');
  });

  it('refuses anything else with a clear message', () => {
    for (const code of ['', '12345', '1234567', '12345a']) {
      const r = totpCodeSchema.safeParse({ code });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0].message).toBe('Enter the 6-digit code from your authenticator app');
    }
  });
});

describe('two-factor rules', () => {
  it('is required for staff only', () => {
    expect(requiresTwoFactor([PERMS.ADMIN_ACCESS])).toBe(true);
    expect(requiresTwoFactor([])).toBe(false);
  });

  it('is still needed until the session is verified', () => {
    expect(needsTwoFactor({ required: true, enabled: false, verified: false })).toBe(true);
    expect(needsTwoFactor({ required: true, enabled: true, verified: false })).toBe(true);
    expect(needsTwoFactor({ required: true, enabled: true, verified: true })).toBe(false);
    expect(needsTwoFactor({ required: false, enabled: false, verified: false })).toBe(false);
    expect(needsTwoFactor(undefined)).toBe(false);
  });
});
