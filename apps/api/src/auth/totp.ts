import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps) — the defaults every
 * authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy) understands.
 */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export const timeStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);

/** The code for one time step (HOTP with the step as the counter). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Returns the time step `code` belongs to, allowing one step either side for clock drift, or null.
 * The caller must refuse steps it has already accepted (replay).
 */
export function matchTotpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(now);
  let matched: number | null = null;
  // Check every candidate so timing does not reveal which step matched.
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) matched ??= step;
  }
  return matched;
}

/** `otpauth://` link encoded in the setup QR code. */
export function totpUri(secret: string, account: string, issuer = 'BizNexa'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
