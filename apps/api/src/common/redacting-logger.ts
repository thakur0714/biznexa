import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * PII scrubbing for everything the API logs (M12.2, D65). Log lines often carry error messages built
 * from request data (a Prisma error quotes the values it was given), so scrubbing happens once, in the
 * logger, instead of at every call site.
 *
 * Strings: emails, Indian mobile numbers, PANs, Aadhaar-shaped numbers, JWTs, bearer tokens and
 * `password=…`-style pairs are replaced. Objects: values under sensitive keys are replaced whole.
 */
const REPLACEMENTS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'],
  [/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [token]'],
  [
    /\b(password|passwd|pwd|secret|token|otp|api[_-]?key|authorization|cookie)(\s*["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi,
    (_m, key: string, sep: string) => `${key}${sep}[redacted]`,
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[pan]'],
  // Before mobiles: a 12-digit Aadhaar would otherwise leave two digits around a "[mobile]".
  [/(?<![\d-])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d-])/g, '[aadhaar]'],
  [/(?<![\w-])(?:\+?91[ -]?)?[6-9]\d{9}(?![\w-])/g, '[mobile]'],
];

const SENSITIVE_KEY = /^(password|passwordhash|newpassword|currentpassword|secret|totpsecret|token|accesstoken|refreshtoken|resettoken|idtoken|otp|code|devcode|authorization|cookie|pan|panenc|aadhaar|email|mobile|phone)$/i;

export function redactString(s: string): string {
  let out = s;
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to as string);
  return out;
}

/** Deep copy with PII removed; Errors keep their class name, message and stack (all scrubbed). */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) {
    const copy = new Error(redactString(value.message));
    copy.name = value.name;
    copy.stack = value.stack ? redactString(value.stack) : undefined;
    return copy;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) && v != null ? '[redacted]' : redact(v, seen)]),
  );
}

/** Nest's console logger with every message and stack trace passed through `redact`. */
export class RedactingLogger extends ConsoleLogger {
  protected printMessages(messages: unknown[], context?: string, logLevel?: LogLevel, writeStreamType?: 'stdout' | 'stderr', errorStack?: unknown): void {
    super.printMessages(
      messages.map((m) => redact(m)),
      // Nest takes a trailing string argument as the context, so it can hold data too.
      context && redactString(context),
      logLevel,
      writeStreamType,
      typeof errorStack === 'string' ? redactString(errorStack) : errorStack,
    );
  }

  protected printStackTrace(stack: string): void {
    super.printStackTrace(typeof stack === 'string' ? redactString(stack) : stack);
  }
}
