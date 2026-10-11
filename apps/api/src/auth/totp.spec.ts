import { base32Decode, base32Encode, generateTotpSecret, matchTotpStep, timeStep, totpCode, totpUri } from './totp';
import { decryptField, encryptField } from '../common/encryption';

// RFC 6238 appendix B (SHA-1 seed "12345678901234567890"); the 8-digit vectors' last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, code] of RFC_VECTORS) expect(totpCode(RFC_SECRET, timeStep(seconds * 1000))).toBe(code);
  });

  it('round-trips base32 and makes 160-bit secrets', () => {
    const buf = Buffer.from('any bytes \x00\xff');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it('accepts the current code and one step of clock drift either side, nothing further', () => {
    const now = 1_760_000_000_000;
    const step = timeStep(now);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotpStep(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now)).toBeNull();
  });

  it('refuses malformed codes and codes from another secret', () => {
    const now = Date.now();
    expect(matchTotpStep(RFC_SECRET, '12345', now)).toBeNull();
    expect(matchTotpStep(RFC_SECRET, 'abcdef', now)).toBeNull();
    const other = generateTotpSecret();
    const code = totpCode(other, timeStep(now));
    // A 1-in-a-million chance the other secret produces the same code in the window; skip the check then.
    if ([-1, 0, 1].some((d) => totpCode(RFC_SECRET, timeStep(now) + d) === code)) return;
    expect(matchTotpStep(RFC_SECRET, code, now)).toBeNull();
  });

  it('builds an otpauth link authenticator apps understand', () => {
    const url = new URL(totpUri('JBSWY3DPEHPK3PXP', 'asha@biznexa.in'));
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/BizNexa:asha@biznexa.in');
    expect(Object.fromEntries(url.searchParams)).toEqual({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'BizNexa', algorithm: 'SHA1', digits: '6', period: '30' });
  });
});

describe('field encryption', () => {
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY ??= 'unit-test-data-encryption-key';
  });

  it('round-trips, uses a fresh IV each time and never stores the plain text', () => {
    const a = encryptField('JBSWY3DPEHPK3PXP');
    const b = encryptField('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(a.startsWith('v1.')).toBe(true);
    expect(decryptField(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const [v, iv, tag, data] = encryptField('secret').split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => decryptField([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => decryptField('plain-text')).toThrow('Unrecognised encrypted value');
  });
});
