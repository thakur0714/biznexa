import 'server-only';
import { headers } from 'next/headers';
import { createApiClient, type Schemas } from '@biznexa/api-client';

const api = createApiClient({ baseUrl: process.env.API_URL ?? 'http://localhost:4000' });

export type VerifyResult = Schemas['CertificateVerifyResult'];
export type OrgResult = Schemas['CertificateOrgResult'][number];

const UNAVAILABLE = 'Verification is unavailable right now. Please try again shortly.';

/** Forward the visitor's IP so the API's per-IP rate limit and lookup log reflect the real person. */
async function forwardHeaders() {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? '';
  return { accept: 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}), 'user-agent': h.get('user-agent') ?? '' };
}

export type Lookup<T> = { ok: true; data: T } | { ok: false; message: string; captchaRequired?: boolean };

async function lookup<T>(request: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<Lookup<T>> {
  try {
    const { data, error, response } = await request();
    if (response.status === 429) {
      // M12.3: after a few lookups the API asks for a captcha instead of only making the visitor wait.
      if ((error as { captchaRequired?: boolean } | undefined)?.captchaRequired) {
        return { ok: false, message: 'Please complete the quick check below to continue.', captchaRequired: true };
      }
      return { ok: false, message: 'Too many checks from your connection. Please wait a minute and try again.' };
    }
    if (data === undefined) {
      const body = (error ?? {}) as { message?: string; errors?: { message: string }[] };
      return { ok: false, message: body.errors?.[0]?.message ?? body.message ?? UNAVAILABLE };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }
}

export function verifyCertificate(query: { number?: string; id?: string; t?: string; captchaToken?: string }) {
  return lookup(async () => api.GET('/api/public/certificates/verify', { params: { query }, headers: await forwardHeaders(), cache: 'no-store' }));
}

export function searchOrganization(organization: string) {
  return lookup(async () => api.GET('/api/public/certificates/search', { params: { query: { organization } }, headers: await forwardHeaders(), cache: 'no-store' }));
}
