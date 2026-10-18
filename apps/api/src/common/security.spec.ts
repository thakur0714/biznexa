import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { parseEnv } from '../config/env';
import { corsOrigins, helmetOptions, HSTS_MAX_AGE, refreshCookieOriginCheck } from './security';

describe('secure headers (M12.1)', () => {
  it('sends HSTS and the default CSP in production only', () => {
    expect(helmetOptions('production')).toEqual({ strictTransportSecurity: { maxAge: HSTS_MAX_AGE, includeSubDomains: true } });
    expect(HSTS_MAX_AGE).toBeGreaterThanOrEqual(31_536_000);
    expect(helmetOptions('development')).toEqual({ contentSecurityPolicy: false, strictTransportSecurity: false });
    expect(helmetOptions('test')).toEqual({ contentSecurityPolicy: false, strictTransportSecurity: false });
  });
});

describe('refresh cookie origin check (M12.1)', () => {
  const check = refreshCookieOriginCheck('bn_rt', ['http://localhost:3000', 'http://localhost:3001']);
  const run = (req: Partial<Request>) => {
    let passed: unknown = 'not called';
    check({ method: 'POST', headers: {}, cookies: {}, ...req } as Request, {} as Response, ((e?: unknown) => (passed = e)) as NextFunction);
    return passed;
  };

  it('blocks a cookie-carrying request from an unknown origin', () => {
    expect(run({ headers: { origin: 'https://evil.example' }, cookies: { bn_rt: 'x' } })).toBeInstanceOf(ForbiddenException);
  });

  it('lets through allowed origins, requests without the cookie or without an Origin, and safe methods', () => {
    expect(run({ headers: { origin: 'http://localhost:3001' }, cookies: { bn_rt: 'x' } })).toBeUndefined();
    expect(run({ headers: { origin: 'https://evil.example' } })).toBeUndefined();
    expect(run({ cookies: { bn_rt: 'x' } })).toBeUndefined();
    expect(run({ method: 'GET', headers: { origin: 'https://evil.example' }, cookies: { bn_rt: 'x' } })).toBeUndefined();
  });
});

describe('CORS allow-list (M12.1)', () => {
  const issues = (CORS_ORIGINS: string, NODE_ENV = 'development') => {
    const res = parseEnv({ ...process.env, NODE_ENV, CORS_ORIGINS });
    return res.success ? [] : res.error.issues.filter((i) => i.path[0] === 'CORS_ORIGINS').map((i) => i.message);
  };

  it('accepts exact origins', () => {
    expect(issues('http://localhost:3000, http://localhost:3001')).toEqual([]);
    expect(corsOrigins('http://localhost:3000, http://localhost:3001,')).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('refuses wildcards, paths and empty lists', () => {
    expect(issues('*')).toEqual([expect.stringMatching(/not an origin/)]);
    expect(issues('https://*.biznexa.com')).toEqual([expect.stringMatching(/not an origin/)]);
    expect(issues('https://biznexa.com/app')).toEqual([expect.stringMatching(/not an origin/)]);
    expect(issues(' , ')).toEqual(['List at least one origin']);
  });

  it('requires https in production', () => {
    expect(issues('http://biznexa.com', 'production')).toEqual([expect.stringMatching(/https in production/)]);
    expect(issues('https://biznexa.com,https://admin.biznexa.com', 'production')).toEqual([]);
  });
});
