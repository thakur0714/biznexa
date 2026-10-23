/**
 * Typed BizNexa API client. `schema.ts` and `openapi.json` are generated — run
 * `pnpm --filter @biznexa/api-client generate` after changing an API route; CI fails if they are stale.
 *
 *   const api = createApiClient({ baseUrl: process.env.API_URL });
 *   const { data, error } = await api.GET('/api/public/certificates/verify', { params: { query: { number } } });
 */
import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema';
import type { PriceBreakdown } from '@biznexa/types';

export type { components, paths };
/** Named response/request schemas, e.g. `Schemas['CertificateVerifyResult']`. */
export type Schemas = components['schemas'];

export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>(options);
}
export type ApiClient = ReturnType<typeof createApiClient>;

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

/** GET /catalogue/categories/:slug — one category with its SEO content (sanitised HTML) and FAQs. */
export interface CategoryDetail {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  icon: string | null;
  journeyStage: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  seoContent: string | null;
  subcategories: { slug: string; name: string }[];
  faqs: { question: string; answer: string }[];
}
