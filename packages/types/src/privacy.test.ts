import { describe, expect, it } from 'vitest';
import { createDataRequestInput } from './privacy';

const issues = (v: unknown) => {
  const r = createDataRequestInput.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('createDataRequestInput', () => {
  it('accepts an export with nothing else', () => {
    expect(issues({ type: 'EXPORT' })).toEqual([]);
  });

  it('needs a confirmed deletion with exactly one of password or code', () => {
    expect(issues({ type: 'DELETION', confirm: true, password: 'x' })).toEqual([]);
    expect(issues({ type: 'DELETION', confirm: true, otp: '123456' })).toEqual([]);
    expect(issues({ type: 'DELETION', password: 'x' })).toEqual(['confirm']);
    expect(issues({ type: 'DELETION', confirm: true })).toEqual(['password']);
    expect(issues({ type: 'DELETION', confirm: true, password: 'x', otp: '123456' })).toEqual(['password']);
    expect(issues({ type: 'DELETION', confirm: true, otp: '12345' })).toEqual(['otp']);
  });

  it('refuses unknown fields and long reasons', () => {
    expect(issues({ type: 'EXPORT', userId: 'someone-else' })).toEqual(['']);
    expect(issues({ type: 'EXPORT', reason: 'x'.repeat(501) })).toEqual(['reason']);
  });
});
