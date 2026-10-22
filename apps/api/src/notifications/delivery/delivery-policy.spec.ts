import { generateKeyPairSync, sign } from 'node:crypto';
import {
  deliveryIdempotencyKey,
  isPermanentFailure,
  isPermanentHttpStatus,
  MAX_RETRY_DELAY_MS,
  PermanentDeliveryError,
  retryDelayMs,
  safeErrorText,
} from './delivery-policy';
import { msg91Outcome, sendgridSignatureValid } from './delivery-callbacks.service';
import { MissingTemplateVariableError } from '../template-engine.service';

describe('retryDelayMs (M6.3 backoff)', () => {
  it('grows 4× per retry from 30 s and stops at 1 h', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(n))).toEqual([30_000, 120_000, 480_000, 1_920_000, 3_600_000, 3_600_000]);
    expect(retryDelayMs(50)).toBe(MAX_RETRY_DELAY_MS);
  });

  it('treats 0 or less as the first retry and uses the given base', () => {
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(-3, 20)).toBe(20);
    expect(retryDelayMs(3, 20)).toBe(320);
  });

  it('adds at most 10 % jitter', () => {
    expect(retryDelayMs(1, 30_000, 1)).toBe(33_000);
    expect(retryDelayMs(1, 30_000, 0.5)).toBe(31_500);
    expect(retryDelayMs(1, 30_000, 7)).toBe(33_000);
  });
});

describe('deliveryIdempotencyKey', () => {
  const base = { event: 'payment.succeeded', sourceKey: 'pay-1', userId: 'u-1', channel: 'EMAIL' as const };

  it('is the same for the same event occurrence, user and channel', () => {
    expect(deliveryIdempotencyKey(base)).toBe(deliveryIdempotencyKey({ ...base }));
    expect(deliveryIdempotencyKey(base)).toBe('payment.succeeded|pay-1|u-1|EMAIL');
  });

  it('differs when any part differs', () => {
    const key = deliveryIdempotencyKey(base);
    expect(deliveryIdempotencyKey({ ...base, sourceKey: 'pay-2' })).not.toBe(key);
    expect(deliveryIdempotencyKey({ ...base, userId: 'u-2' })).not.toBe(key);
    expect(deliveryIdempotencyKey({ ...base, channel: 'SMS' })).not.toBe(key);
    expect(deliveryIdempotencyKey({ ...base, event: 'payment.failed' })).not.toBe(key);
  });

  it('refuses an empty part (a missing source would merge different occurrences)', () => {
    expect(() => deliveryIdempotencyKey({ ...base, sourceKey: '' })).toThrow('sourceKey is required');
  });
});

describe('permanent failures', () => {
  it('4xx except 408 / 429 is permanent', () => {
    expect([400, 401, 403, 404, 422].every((item) => isPermanentHttpStatus(item))).toBe(true);
    expect([408, 429, 500, 502, 503, 200].some((item) => isPermanentHttpStatus(item))).toBe(false);
  });

  it('provider refusals and template errors are permanent; anything else is not', () => {
    expect(isPermanentFailure(new PermanentDeliveryError('bad number'))).toBe(true);
    expect(isPermanentFailure(new MissingTemplateVariableError('x'))).toBe(true);
    expect(isPermanentFailure(new Error('ECONNRESET'))).toBe(false);
  });
});

describe('safeErrorText', () => {
  it('masks emails and mobile numbers, keeps the rest on one line', () => {
    expect(safeErrorText('SendGrid delivery failed (400): {"errors":[{"message":"Invalid email alice.s@example.co.in"}]}')).toBe(
      'SendGrid delivery failed (400): {"errors":[{"message":"Invalid email [email]"}]}',
    );
    expect(safeErrorText('Bad number +91 98765 43210\nfor user')).toBe('Bad number [number] for user');
    expect(safeErrorText('x'.repeat(500))).toHaveLength(300);
  });
});

describe('msg91Outcome', () => {
  it('maps MSG91 report codes', () => {
    expect(msg91Outcome('1', 'DELIVERED')).toBe('DELIVERED');
    expect(msg91Outcome('2', 'FAILED')).toBe('FAILED');
    expect(msg91Outcome('9', 'NDNC')).toBe('FAILED');
    expect(msg91Outcome('16', 'Rejected')).toBe('FAILED');
    expect(msg91Outcome('8', 'Submitted')).toBeNull();
  });
});

describe('sendgridSignatureValid', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const body = Buffer.from('[{"event":"delivered","sg_message_id":"abc.filter1"}]');
  const ts = '1760700000';
  const sig = sign('sha256', Buffer.concat([Buffer.from(ts), body]), privateKey).toString('base64');

  it('accepts the signature over timestamp + body', () => {
    expect(sendgridSignatureValid(pub, body, sig, ts)).toBe(true);
  });

  it('refuses a changed body, timestamp or a garbage key', () => {
    expect(sendgridSignatureValid(pub, Buffer.from(body.toString().replace('delivered', 'bounce')), sig, ts)).toBe(false);
    expect(sendgridSignatureValid(pub, body, sig, '1760700001')).toBe(false);
    expect(sendgridSignatureValid('bm90LWEta2V5', body, sig, ts)).toBe(false);
  });
});
