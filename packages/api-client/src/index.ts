/**
 * Typed BizNexa API client. `schema.ts` and `openapi.json` are generated — run
 * `pnpm --filter @biznexa/api-client generate` after changing an API route; CI fails if they are stale.
 *
 *   const api = createApiClient({ baseUrl: process.env.API_URL });
 *   const { data, error } = await api.GET('/api/public/certificates/verify', { params: { query: { number } } });
 */
import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
/** Named response/request schemas, e.g. `Schemas['CertificateVerifyResult']`. */
export type Schemas = components['schemas'];

export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>(options);
}
export type ApiClient = ReturnType<typeof createApiClient>;
