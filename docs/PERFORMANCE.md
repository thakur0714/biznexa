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

Run the API baseline with the local API and seeded customer available:

```sh
node scripts/perf/load.mjs
```

`PERF_API_URL`, `PERF_CUSTOMER_EMAIL`, `PERF_CUSTOMER_PASSWORD`, `PERF_SERVICE_SLUG`, `PERF_BLOG_SLUG`, `PERF_REQUESTS`, and `PERF_CONNECTIONS` can override defaults. The seeded login defaults are for local development only.
