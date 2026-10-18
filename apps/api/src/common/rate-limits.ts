/**
 * Per-IP limits for sensitive routes (M12.1), on top of the global 120 requests a minute. Each is a
 * `@Throttle()` argument. Counters live in each API instance's memory (see D64).
 */
const perMinute = (limit: number) => ({ default: { limit, ttl: 60_000 } });

/** Password login, registration, OTP and 2FA checks, password reset and change. */
export const AUTH_LIMIT = perMinute(10);
/** Sending an OTP by SMS/email costs money and can be used to spam someone. */
export const OTP_LIMIT = perMinute(5);
/** Refreshing a session: one per tab on page load, so looser than a login. */
export const REFRESH_LIMIT = perMinute(30);
/** Creating a gateway order or reporting a checkout result. */
export const PAYMENT_LIMIT = perMinute(10);
/** Uploading a file (customer documents, public media). */
export const UPLOAD_LIMIT = perMinute(30);
