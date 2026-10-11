 # BizNexa

*Everything your business needs, in one place.* An online platform for Indian businesses to buy, track and receive professional services: company registration, trademark, GST and income tax, ISO certification, licenses, compliance and business technology.

This repository follows the master development prompt (`docs/PROMPT.md`). **Milestones 1 and 2 are built** (foundation + catalogue), together with public certificate verification from Milestone 7. See `docs/CHANGELOG.md` for exactly what works today and what comes next.

## What's inside

```
apps/
  api/      NestJS REST API · Prisma 7 (PostgreSQL) · OpenAPI docs at /api/docs
  web/      Next.js 16 website + customer account (App Router, Tailwind CSS 4)
packages/
  types/    Shared pricing/GST maths, status state machines, formatters, zod schemas
docs/       Prompt, decisions, changelog, runbook
```

## Run it locally (about 10 minutes)

Requirements: Node 22+, pnpm 10+, PostgreSQL 16 (or Docker).

```bash
# 1. Infrastructure (Postgres, Redis, MinIO)
docker compose up -d

# 2. Install
pnpm install

# 3. Configure
cp apps/api/.env.example apps/api/.env          # then set the three secrets (openssl rand -hex 32)
cp apps/web/.env.example apps/web/.env.local

# 4. Database
pnpm --filter @biznexa/types build
cd apps/api && npx prisma generate && npx prisma migrate deploy && pnpm prisma:seed && cd ../..

# 5. Start both apps
pnpm --filter @biznexa/api dev     # http://localhost:4000/api   (docs: /api/docs)
pnpm --filter @biznexa/web dev     # http://localhost:3000
```

### Demo logins (development seed only — never created in production)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@biznexa.local | Admin@12345 |
| Operations Executive | ops@biznexa.local | Ops@12345 |
| Support Executive | support@biznexa.local | Support@12345 |
| Consultant | consultant@biznexa.local | Consultant@12345 |
| Customer | customer@biznexa.local | Customer@12345 (mobile 9876543210 for OTP login) |

In development, OTP codes are printed in the API log **and** shown on screen ("Development mode: your code is …"). Neither happens in production.

### Demo certificates for the Verify page

| Verification ID | Certificate number | Status |
|---|---|---|
| DEMQ9001ACTV | BNC-DEMO-000001 | Active |
| DEMQ14KEXPRD | BNC-DEMO-000002 | Expired |
| DEMQ45KSUSPN | BNC-DEMO-000003 | Suspended |

## Tests

```bash
pnpm --filter @biznexa/types test     # pricing, GST split, coupons, state machines, formatting (15)
cd apps/api && npx jest               # API integration tests on a real database + search unit tests (25)
cd apps/web && pnpm e2e               # Playwright browser tests, desktop + mobile (14) — needs API + web running
```

## Production notes

- Create the first admin with `ADMIN_NAME=… ADMIN_EMAIL=… ADMIN_MOBILE=… ADMIN_PASSWORD=… pnpm --filter @biznexa/api create-admin`.
- The API refuses to start in production with weak secrets or the console SMS provider.
- Run `npx prisma migrate deploy` as a release step before starting a new API version.
- Dockerfiles: `apps/api/Dockerfile`, `apps/web/Dockerfile` (build from the repo root). CI: `.github/workflows/ci.yml`.
- **Seed prices are placeholders** and **SAC codes must be confirmed by your CA** before invoices go live.
