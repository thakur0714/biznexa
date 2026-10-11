# Runbook

## Apps (local)
| App | Port | Start |
|-----|------|-------|
| API | 4000 | `pnpm --filter @biznexa/api dev` |
| Website + customer dashboard | 3000 | `pnpm --filter @biznexa/web dev` |
| Admin / ops portal | 3001 | `pnpm --filter @biznexa/admin dev` (copy `apps/admin/.env.example` to `.env.local`) |

Browsers share cookies across ports on the same host, so in local dev the website and the admin portal share the `bn_rt` refresh cookie on `localhost`. To keep a customer session and a staff session open side by side, open the admin portal at `http://127.0.0.1:3001` instead. In production the two apps run on separate hostnames, so their cookies never mix.

## Health
- API: `GET /api/health` → `{ "status": "ok" }` (checks the database).

## Common tasks
| Task | Command |
|------|---------|
| Apply migrations (release step) | `cd apps/api && npx prisma migrate deploy` |
| Create a migration after editing `schema.prisma` | `cd apps/api && npx prisma migrate dev --name <change>` |
| Regenerate the typed API client after changing an API route (CI fails if stale; no database needed) | `pnpm --filter @biznexa/api-client generate` |
| Re-run seed (idempotent; only adds what is missing — never removes a role's permissions or renames a role; a permission new in the code is granted to the roles that get it by default, once) | `pnpm db:seed` |
| Create the first production admin | `ADMIN_NAME=… ADMIN_EMAIL=… ADMIN_MOBILE=… ADMIN_PASSWORD=… pnpm --filter @biznexa/api create-admin` |
| Give a role access to the admin portal | Grant it the `admin.access` permission (seeded for ADMIN, OPERATIONS, CONSULTANT, SUPPORT). Takes effect at the user's next login/refresh. |
| Reset 2FA for a staff member who lost their authenticator app (verify who is asking first; also logs them out everywhere) | `EMAIL=… pnpm --filter @biznexa/api reset-2fa` |
| Force a user to log in again everywhere | `UPDATE "RefreshToken" SET "revokedAt" = now() WHERE "userId" = '<id>' AND "revokedAt" IS NULL;` |

## File storage (D17)
Uploaded documents, deliverables and generated PDFs live under the API's `UPLOAD_DIR` (from M2.5.6). It must be a persistent volume shared by all API instances, kept outside any publicly served folder, and included in backups. Files are never served directly — only through signed API download links.
- Layout: `UPLOAD_DIR/<2 hex>/<32 hex>` — random keys, no extensions or original names. The `StoredFile` table maps a key to its owner, original name, detected type, size and SHA-256. A key on disk without a row is an orphan and safe to delete.
- Limits: per document requirement (`acceptedTypes`, `maxSizeMb`), default PDF/JPG/PNG and 10 MB, never above `UPLOAD_MAX_MB` (default 25). A reverse proxy in front of the API must allow request bodies at least that large (nginx `client_max_body_size`).
- Responses: 413 too large, 415 wrong extension or content that does not match it, 404 when a user asks for a link to a file they may not read.
- Find who uploaded a file: `SELECT "ownerId", "originalName", "createdAt" FROM "StoredFile" WHERE "fileKey" = '<key>';`

## Virus scanning (D23)
Every upload is scanned by a `file-scan` queue job; `StoredFile.scanStatus` goes `PENDING` → `CLEAN` or `INFECTED`. Only `CLEAN` files get download links (409 while pending, 410 when infected). Infected files' bytes are deleted at once; the row stays with `scanSignature`.
- Production: `VIRUS_SCANNER=clamav`, `CLAMAV_HOST`/`CLAMAV_PORT` pointing at clamd (TCP, INSTREAM). The API refuses to start with the `stub` scanner in production. clamd's `StreamMaxLength` must be at least `UPLOAD_MAX_MB`, or large files fail to scan and stay PENDING.
- Development and tests need no ClamAV: the default `stub` scanner flags only the EICAR test file. To try real ClamAV locally, run clamd with TCP enabled on port 3310 (e.g. Homebrew `clamav`: `freshclam`, then `clamd` with `TCPSocket 3310` in `clamd.conf`) and set `VIRUS_SCANNER=clamav`.
- ClamAV down: scans retry for ≈20 minutes, then go to the `dead-letter` queue; the files stay PENDING. Once clamd is back, requeue the dead letters or restart the API (it queues every PENDING file on start).
- Files waiting: `SELECT id, "createdAt" FROM "StoredFile" WHERE "scanStatus" = 'PENDING' ORDER BY "createdAt";`
- Infected uploads: `SELECT id, "ownerId", "originalName", "scanSignature", "scannedAt" FROM "StoredFile" WHERE "scanStatus" = 'INFECTED' ORDER BY "scannedAt" DESC;`

## Staff two-factor authentication (D27)
Every account with `admin.access` must use an authenticator app (TOTP). After the password (or OTP/Google) login, a staff session has **no permissions** until the code is entered on `/two-factor` in the admin portal; the first login shows a QR code to set the app up. Staff routes called before that return 403 with `code: "TWO_FACTOR_REQUIRED"`.
- Each code works once. 5 wrong codes in a row lock the 2FA check for 15 minutes (`user.2fa_locked` in the audit log); the lock clears itself. To clear it early: `UPDATE "User" SET "totpLockedUntil" = NULL, "totpFailures" = 0 WHERE email = '<email>';`
- A verified session stays verified across token refreshes until the refresh token expires (`REFRESH_TTL_DAYS`) or the user logs out.
- Lost phone: `EMAIL=… pnpm --filter @biznexa/api reset-2fa` (see Common tasks). Demo staff in local dev also go through setup at first login; reset them the same way.
- Who has 2FA on: `SELECT email, "totpEnabledAt" FROM "User" WHERE "totpEnabledAt" IS NOT NULL;`

## Domain events (D21)
- In-process only (`EventBus`); events are not stored. A failing listener shows up in the API log as `[Events] Listener for <event> (<id>) failed: …` — the change that emitted it has already been saved.

## Queues (D20)
- BullMQ on Redis (`REDIS_URL`, keys prefixed `QUEUE_PREFIX`, default `bn`). Workers run inside the API process. `GET /api/health` returns 503 if Redis is unreachable.
- Jobs retry 5 times with exponential backoff (5 s, 10 s, 20 s, 40 s). A job that still fails — or throws `UnrecoverableError` — is copied to the **`dead-letter`** queue with its data, error and stack trace. Dead letters are kept until handled.
- Inspect dead letters (until the admin screen exists): `redis-cli LRANGE bn:dead-letter:wait 0 -1` lists their ids; `redis-cli HGET bn:dead-letter:<id> data` shows the original queue, job data, error and attempts. Requeueing is `QueueService.requeueDeadLetter(id)` in code — there is no endpoint yet. Fix the cause first; a requeued job starts with full attempts.
- Production Redis must persist (AOF on) and use `maxmemory-policy noeviction`, or queued jobs can be silently dropped.

## Scheduled jobs
- 00:05 IST daily — mark certificates past `validUntil` as EXPIRED (`CertificatesService.expireCertificates`).

## Secrets (API)
`JWT_ACCESS_SECRET`, `OTP_PEPPER`, `CERT_QR_SECRET`, `FILE_LINK_SECRET`, `DATA_ENCRYPTION_KEY` — 32+ random characters each in production. **Never rotate `DATA_ENCRYPTION_KEY`** once data exists: it encrypts staff 2FA secrets (and PAN later), which become unreadable — every staff member would need `reset-2fa`. Keep it in the secrets manager and its backups. Rotating `FILE_LINK_SECRET` only breaks download links issued in the last 5 minutes. Rotating `CERT_QR_SECRET` invalidates the "genuine QR" check on already-printed certificates (lookups still work), so rotate only if leaked.
