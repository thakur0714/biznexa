import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { HelmetOptions } from 'helmet';

/** Two years: the minimum the HSTS preload list accepts, should the domain be submitted later. */
export const HSTS_MAX_AGE = 63_072_000;

/**
 * Secure headers (M12.1). Production gets helmet's defaults (a strict CSP for this JSON API, nosniff,
 * frame-ancestors none, no X-Powered-By…) plus HSTS. Development and tests run on plain http, where HSTS
 * would only pin localhost to https, and Swagger UI needs inline scripts.
 */
export function helmetOptions(nodeEnv: string): HelmetOptions {
  if (nodeEnv !== 'production') return { contentSecurityPolicy: false, strictTransportSecurity: false };
  return { strictTransportSecurity: { maxAge: HSTS_MAX_AGE, includeSubDomains: true } };
}

/** `CORS_ORIGINS` as a list. env.ts has already refused `*`, paths and (in production) plain http. */
export const corsOrigins = (raw: string) => raw.split(',').map((o) => o.trim()).filter(Boolean);

/**
 * CSRF defence in depth for the routes that read the refresh cookie (D64). The cookie is httpOnly,
 * SameSite=Lax and scoped to /api/auth, and every other route takes a bearer token, so a cross-site form
 * cannot use it today. This also refuses any browser request that carries the cookie from an origin outside
 * the allow-list, should a browser or proxy ever send it cross-site.
 */
export function refreshCookieOriginCheck(cookieName: string, allowed: readonly string[]) {
  const ok = new Set(allowed);
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const unsafe = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (unsafe && origin && req.cookies?.[cookieName] && !ok.has(origin)) {
      return next(new ForbiddenException('Request blocked: unknown origin'));
    }
    next();
  };
}
