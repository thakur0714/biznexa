import { afterEach, describe, expect, it, vi } from 'vitest';

/** Secure headers on every page (M12.1). */
async function headersFor(nodeEnv: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  const { default: config } = await import('../next.config');
  const rules = await config.headers!();
  return Object.fromEntries(rules.flatMap((r) => r.headers).map((h) => [h.key, h.value]));
}

describe('next.config headers', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sends HSTS in production', async () => {
    const h = await headersFor('production');
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains');
    expect(h).toMatchObject({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
  });

  it('leaves HSTS out in development (plain http)', async () => {
    expect((await headersFor('development'))['Strict-Transport-Security']).toBeUndefined();
  });
});
