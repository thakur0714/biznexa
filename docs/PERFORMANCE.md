# Performance

## Baseline — 19 Oct 2026

Measured on the seeded local PostgreSQL database with the API on `:4300` and the production web server on `:3300`. The API was started with `node -r @swc-node/register src/main.ts`. The web app was built in production mode and served with `next start`.

The requested default `next build` (Turbopack) could not start its local worker because the environment denied its port bind. `next build --webpack` completed successfully and produced the build used for Lighthouse. Lighthouse 13.5.0 ran headless Chrome with its default mobile emulation and throttling. API samples used `npx autocannon`, 4 connections and 12 requests per endpoint; p95 is interpolated between autocannon's p90 and p97.5 histogram buckets. These short samples are a local baseline, not a production capacity test.

| API endpoint | p50 | p95* | p99 | Response |
| --- | ---: | ---: | ---: | --- |
| `GET /api/catalogue/services` | 20 ms | 55.33 ms | 62 ms | 200 |
| `GET /api/catalogue/services/private-limited-company-registration` | 4 ms | 10 ms | 10 ms | 200 |
| `GET /api/catalogue/search?q=company` | 4 ms | 14.33 ms | 15 ms | 200 |
| `GET /api/public/blog/posts` | 2 ms | 7 ms | 7 ms | 200 |
| `GET /api/public/blog/posts/perf-baseline-no-published-post` | 1 ms | 5 ms | 5 ms | 404 |
| `GET /api/applications` (seeded customer token) | 2 ms | 12 ms | 12 ms | 200 |
| `GET /api/dashboard/summary` (seeded customer token) | 4 ms | 11 ms | 11 ms | 200 |
| `GET /api/notifications` (seeded customer token) | 1 ms | 9.67 ms | 10 ms | 200 |

The seed contains no published blog posts, so the detail-route measurement is a not-found lookup. The blog list endpoint returned an empty list. Re-run with `PERF_BLOG_SLUG` set to a published post slug when one is available.

The Step 1 run passed: all measured API p95 values were below 300 ms. Lighthouse Performance scores were **87/100** on `/` and **90/100** on `/services/company-registration/private-limited-company-registration`. Homepage metrics: FCP 1.4 s, LCP 3.8 s, TBT 140 ms, CLS 0. Service page: FCP 1.4 s, LCP 3.5 s, TBT 110 ms, CLS 0.

*Interpolated p95, as autocannon's CLI summary exposes p90 and p97.5 rather than p95 directly.*

## Query review — 19 Oct 2026

Repeated the eight-endpoint load with `PRISMA_QUERY_TIMING=true`. Prisma emitted 548 query events; none took more than 50 ms. Repeated SQL fingerprints matched repeated endpoint requests, not a per-row query pattern. The blog relation lookups used empty `IN (NULL)` sets because the seeded database has no published posts. No missing filter/sort index was indicated by this run, so no index migration was added.

The code review found one dashboard N+1 path that the seeded demo customer could not exercise: the dashboard called `pendingMandatory` separately for each selected application. It now calls the existing `pendingMandatoryMany` batch method. `apps/api/test/customer-applications.e2e-spec.ts` checks that dashboard summary values stay the same and it invokes the batch method once; the existing batch test compares results with the per-application method and verifies a constant query count for 2 versus 10 applications. The two affected API integration suites passed (95 tests before the dashboard assertion was added; the updated customer application suite passed 10 tests).

The seed customer has no applications, so the load run does not quantify dashboard latency with a non-empty checklist. The test fixtures exercise the batch path and its data equivalence.

## Public response caching — 19 Oct 2026

Added bounded, request-coalescing in-memory caches for public catalogue categories, service lists, popular services and service detail (60-second TTL), plus published blog lists, taxonomies and post detail (300-second TTL). Successful writes publish `catalogue.changed`, `blog.post_changed` or `blog.taxonomy_changed` after the write and audit; these events evict the corresponding public caches. The homepage CMS update emits the catalogue event because it can change the configured popular-service list. Errors and not-found responses are not cached. No per-user or staff responses are cached.

The web app already uses Next revalidation for catalogue and blog fetches. These API caches also cover mobile and direct API consumers. The cache is process-local: each API instance invalidates its own entries, and the TTL bounds staleness across instances. The public-blog and catalogue-cache integration suites passed (8 tests), including cache-hit query counts and refresh after domain events.

Run the API baseline with the local API and seeded customer available:

```sh
node scripts/perf/load.mjs
```

`PERF_API_URL`, `PERF_CUSTOMER_EMAIL`, `PERF_CUSTOMER_PASSWORD`, `PERF_SERVICE_SLUG`, `PERF_BLOG_SLUG`, `PERF_REQUESTS`, and `PERF_CONNECTIONS` can override defaults. The seeded login defaults are for local development only.

## After — 19 Oct 2026 (Claude review)

Same setup (seeded local DB, API with `node -r @swc-node/register`, web `next build && next start`, Lighthouse 13.5.0 mobile emulation).

| Check | Before | After |
| --- | ---: | ---: |
| Lighthouse Performance `/` | 87 | **96** (LCP 2.8 s, TBT 20 ms, CLS 0) |
| Lighthouse Performance service page | 90 | **96** (LCP 2.8 s, TBT 10 ms, CLS 0) |
| Highest API p95 (catalogue search) | 55 ms | 34 ms |

Frontend change: the browser Sentry SDK is loaded only when `NEXT_PUBLIC_SENTRY_DSN` is set, and then lazily, so it no longer ships in the main bundle. Review fix: editing a service's documents, stages, FAQs or related services now evicts the public catalogue cache too (before, the public page could show the old values for up to 60 s plus the web's 300 s revalidation).

**Limits of these numbers.** They come from 12 requests per endpoint on a laptop with a small seeded database. They show there is no slow query or N+1 on these paths, but they are not a capacity test. Re-run `scripts/perf/load.mjs` (with more `PERF_REQUESTS` / `PERF_CONNECTIONS`) and Lighthouse against staging once M12.9 infra exists, with production-sized data.
