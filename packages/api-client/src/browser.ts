'use client';

/**
 * `ClientApiError` for every browser call, plus small untyped `get`/`post` helpers kept only for the auth
 * providers' own session calls (refresh, logout), which run outside `ApiProvider`. Everything else uses
 * `useApi()` from `@biznexa/api-client/react` (D26).
 */
export interface FieldError {
  field: string;
  message: string;
}

export class ClientApiError extends Error {
  constructor(public status: number, message: string, public errors: FieldError[] = [], public retryAfter?: number) {
    super(message);
  }
  fieldError(name: string) {
    return this.errors.find((e) => e.field === name)?.message;
  }
}

export async function post<T>(path: string, body?: unknown, token?: string): Promise<T> {
  return call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, token);
}

export async function get<T>(path: string, token?: string): Promise<T> {
  return call<T>(path, { method: 'GET' }, token);
}

async function call<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ClientApiError(0, 'Could not reach BizNexa. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data.message === 'string' ? data.message : 'Something went wrong. Please try again.';
    throw new ClientApiError(res.status, message, data.errors ?? [], data.retryAfter);
  }
  return data as T;
}
