/**
 * Server-side API access for Server Components. Browser code calls /api/* directly
 * (rewritten to the API by next.config.ts).
 */


const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { revalidate?: number }): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    next: { revalidate: init?.revalidate ?? 60 },
    headers: { accept: 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Like api() but returns null on 404 (for notFound() handling). */
export async function apiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

// ─────────────── Response types ───────────────

export type {
  CategoryDetail,
  CategorySummary,
  ServiceCard,
  ServiceList,
  ServicePackage,
  ServiceDetail,
} from '@biznexa/api-client';

