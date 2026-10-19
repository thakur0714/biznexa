import { redact, redactString, RedactingLogger } from './redacting-logger';

describe('log redaction (M12.2)', () => {
  it.each([
    ['Unique constraint failed for asha.rao@example.com', 'Unique constraint failed for [email]'],
    ['SMS to 9876543210 failed', 'SMS to [mobile] failed'],
    ['SMS to +91 9876543210 failed', 'SMS to [mobile] failed'],
    ['PAN ABCDE1234F rejected', 'PAN [pan] rejected'],
    ['aadhaar 2345 6789 0123 seen', 'aadhaar [aadhaar] seen'],
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123', 'token [token]'],
    ['Authorization: Bearer abc.def.ghi', 'Authorization: [redacted] [token]'],
    ['login failed password=hunter2&next=/', 'login failed password=[redacted]&next=/'],
    ['{"otp":"123456","purpose":"LOGIN"}', '{"otp":"[redacted]","purpose":"LOGIN"}'],
  ])('scrubs %s', (input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it('leaves ids, amounts and timestamps alone', () => {
    const line = 'Order 3f2b9c1e-0d4a-4b7e-9a51-1234567890ab paid 1999900 paise at 1729270000000 (BN-APP-000123)';
    expect(redactString(line)).toBe(line);
  });

  it('replaces values under sensitive keys and scrubs nested strings and errors', () => {
    const err = new Error('duplicate mobile 9876543210');
    const out = redact({ user: { email: 'a@b.co', name: 'Asha', password: 'x', note: 'call 9876543210' }, refreshToken: 'abc', err }) as Record<string, any>;
    expect(out.user).toEqual({ email: '[redacted]', name: 'Asha', password: '[redacted]', note: 'call [mobile]' });
    expect(out.refreshToken).toBe('[redacted]');
    expect(out.err.message).toBe('duplicate mobile [mobile]');
    expect(out.err.stack).not.toContain('9876543210');
  });

  it('removes email and mobile PII before a value can be logged or reported', () => {
    expect(redact({ message: 'Failed for asha.rao@example.com', mobile: '9876543210' })).toEqual({
      message: 'Failed for [email]',
      mobile: '[redacted]',
    });
  });

  it('copes with circular objects', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(redact(a)).toEqual({ name: 'x', self: '[circular]' });
  });

  it('writes scrubbed lines and stack traces', () => {
    const written: string[] = [];
    const out = jest.spyOn(process.stdout, 'write').mockImplementation((s) => (written.push(String(s)), true));
    const err = jest.spyOn(process.stderr, 'write').mockImplementation((s) => (written.push(String(s)), true));
    try {
      const logger = new RedactingLogger('Test', { colors: false });
      logger.log('OTP sent to user=9876543210 (asha@example.com)');
      logger.warn({ email: 'asha@example.com', pan: 'ABCDE1234F', step: 2 });
      logger.error('Failed for ABCDE1234F', 'Error: x\n    at fn (asha@example.com)', 'Ctx');
      logger.error('Lookup failed', 'context from 9876543210');
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const all = written.join('');
    expect(all).toContain('user=[mobile] ([email])');
    expect(all).toContain('Failed for [pan]');
    expect(all).toContain('step: 2');
    expect(all).toContain('at fn ([email])');
    expect(all).toContain('[context from [mobile]]');
    for (const pii of ['9876543210', 'asha@example.com', 'ABCDE1234F']) expect(all).not.toContain(pii);
  });
});
