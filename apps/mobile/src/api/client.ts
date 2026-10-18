import { createApiClient, type ApiClient, type paths } from '@biznexa/api-client';

export interface FieldError {
  field: string;
  message: string;
}

export class MobileApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors: FieldError[] = [],
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'MobileApiError';
  }

  fieldError(name: string): string | undefined {
    return this.errors.find((e) => e.field === name)?.message;
  }
}

export interface MobileApiSession {
  getToken: () => string | null;
  getRefreshToken: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
}

export interface MobileApiOptions {
  baseUrl?: string;
  session?: MobileApiSession;
}

const DEFAULT_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://10.0.2.2:3000');

export function createMobileApiClient(options: MobileApiOptions = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const session = options.session;

  const client = createApiClient({
    baseUrl,
    headers: {
      'x-client': 'mobile',
    },
  });

  client.use({
    onRequest({ request }) {
      request.headers.set('x-client', 'mobile');
      const token = session?.getToken();
      if (token) {
        request.headers.set('authorization', `Bearer ${token}`);
      }
      return request;
    },
  });

  return client;
}

export type { ApiClient, paths };
