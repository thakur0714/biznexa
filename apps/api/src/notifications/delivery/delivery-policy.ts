import type { NotificationChannel } from '@biznexa/types';
import { MissingTemplateVariableError, TemplateNotFoundError } from '../template-engine.service';

/**
 * Retry and idempotency rules for notification deliveries (M6.3, D59). Pure functions, unit tested.
 */

/** Total tries per delivery (first send + retries). */
export const DELIVERY_ATTEMPTS = 6;
/** First retry waits this long; each next one 4× longer, capped at MAX_RETRY_DELAY_MS. */
export const BASE_RETRY_DELAY_MS = 30_000;
export const MAX_RETRY_DELAY_MS = 60 * 60_000;

/**
 * Wait before retry number `retry` (1 = first retry): 30 s, 2 min, 8 min, 32 min, 60 min.
 * `jitter` (0–1, e.g. Math.random()) adds up to 10 % so many failures at once do not retry together.
 */
export function retryDelayMs(retry: number, base = BASE_RETRY_DELAY_MS, jitter = 0): number {
  const n = Math.max(1, Math.floor(retry));
  const delay = Math.min(base * 4 ** (n - 1), MAX_RETRY_DELAY_MS);
  return Math.round(delay * (1 + 0.1 * Math.min(Math.max(jitter, 0), 1)));
}

/**
 * One delivery per event occurrence, user and channel. `sourceKey` names the occurrence (a payment id,
 * a document version id, a reminder + offset…), so a re-emitted event finds the same key and sends nothing.
 */
export function deliveryIdempotencyKey(input: { event: string; sourceKey: string; userId: string; channel: NotificationChannel }): string {
  for (const [k, v] of Object.entries(input)) {
    if (!v) throw new Error(`deliveryIdempotencyKey: ${k} is required`);
  }
  return [input.event, input.sourceKey, input.userId, input.channel].join('|');
}

/** A failure that trying again will not fix (bad or missing address, provider refused the message). */
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

/** HTTP statuses from a provider that a retry will not change: 4xx except timeout / rate limit. */
export function isPermanentHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Error text safe to store and show staff: emails and long digit runs (mobile numbers) masked,
 * one line, at most 300 characters.
 */
export function safeErrorText(message: string): string {
  return message
    // Dot-separated domain labels and digit-led groups keep both patterns linear (no backtracking). The lookbehind
    // starts an email match only at the start of the local part.
    .replaceAll(/(?<![^\s@<>"'(),;:])[^\s@<>"'(),;:]+@(?:[^\s@<>"'(),;:.]+\.)+[a-z]{2,}/gi, '[email]')
    .replaceAll(/\+?\d(?:[\s-]*\d){6,}/g, '[number]')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** True for errors a retry cannot fix: a provider refusal, or a template that cannot be rendered. */
export function isPermanentFailure(err: unknown): boolean {
  return err instanceof PermanentDeliveryError || err instanceof MissingTemplateVariableError || err instanceof TemplateNotFoundError;
}
