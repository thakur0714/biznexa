/**
 * Server-side API access for Server Components. Browser code calls /api/* directly
 * (rewritten to the API by next.config.ts).
 */
import type { PriceBreakdown } from '@biznexa/types';

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
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
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

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  icon: string | null;
  journeyStage: string | null;
  serviceCount: number;
  subcategories: { slug: string; name: string }[];
  topServices: { slug: string; name: string }[];
}

export interface ServiceCard {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  icon: string | null;
  estimatedTime: string | null;
  startingPrice: number | null;
  governmentFeeFrom: number;
  popularity: number;
  isPopular: boolean;
  category: { slug: string; name: string };
  subcategory: { slug: string; name: string } | null;
}

export interface ServiceList {
  items: ServiceCard[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ServicePackage {
  id: string;
  name: string;
  professionalFee: number;
  governmentFee: number;
  gstRate: number;
  inclusions: string[];
  estimatedTime: string | null;
  isMostPopular: boolean;
  allowPartial: boolean;
  advancePercent: number | null;
  price: PriceBreakdown;
}

export interface ServiceDetail {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  overview: string | null;
  icon: string | null;
  benefits: string[];
  estimatedTime: string | null;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
  startingPrice: number | null;
  seoTitle: string | null;
  metaDescription: string | null;
  recurrence: string | null;
  category: { slug: string; name: string };
  subcategory: { slug: string; name: string } | null;
  packages: ServicePackage[];
  documents: { id: string; name: string; description: string | null; isMandatory: boolean }[];
  stages: { id: string; name: string; description: string | null; sortOrder: number }[];
  faqs: { question: string; answer: string }[];
  related: ServiceCard[];
}
