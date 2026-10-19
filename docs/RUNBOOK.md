# Runbook

## Apps (local)
| App | Port | Start |
|-----|------|-------|
| API | 4000 | `pnpm --filter @biznexa/api dev` |
| Website + customer dashboard | 3000 | `pnpm --filter @biznexa/web dev` |
| Admin / ops portal | 3001 | `pnpm --filter @biznexa/admin dev` (copy `apps/admin/.env.example` to `.env.local`) |

Browsers share cookies across ports on the same host, so in local dev the website and the admin portal share the `bn_rt` refresh cookie on `localhost`. To keep a customer session and a staff session open side by side, open the admin portal at `http://127.0.0.1:3001` instead. In production the two apps run on separate hostnames, so their cookies never mix.

## Health
- API liveness: `GET /api/health` → `{ "status": "ok", "time": "…" }`.
- API readiness: `GET /api/health/ready` → `{ "status": "ready" }`; returns 503 when PostgreSQL or Redis is unavailable.

## Monitoring (M12.8)
### Uptime checks
Create HTTPS GET checks every minute, with a 30-second timeout and alert after 2 consecutive failures:
- Website: `https://biznexa.com/` (expect 200).
- API liveness: `https://<api-host>/api/health` (expect 200 and `status=ok`).
- API readiness: `https://<api-host>/api/health/ready` (expect 200 and `status=ready`).
- Admin: `https://<admin-host>/login` (expect 200).

Use the deployed API and admin hostnames in place of the two host placeholders. The readiness check verifies both database and Redis connectivity.

### Alerts
- **Error rate:** in Sentry, alert when an environment has 20 or more unhandled errors in 5 minutes; page on-call for production and notify the team for staging.
- **5xx:** create a log metric from API JSON records where `message=http_request` and `statusCode >= 500`; alert at 10 events in 5 minutes or a 5xx rate above 2% over 5 minutes (minimum 50 requests).
- **Queue backlog:** alert if any BullMQ queue has more than 100 waiting jobs for 5 minutes, its oldest waiting job exceeds 15 minutes, or the `dead-letter` queue has any waiting jobs. Export these Redis/BullMQ counts to the infrastructure metrics service; the API does not expose a public queue metrics endpoint.

### Sentry DSNs
Create separate Sentry projects for API, website, admin, and mobile. Put each project's DSN in its deployment environment:
- API: `SENTRY_DSN` in the API environment / secret store (documented in `apps/api/.env.example`).
- Website: `NEXT_PUBLIC_SENTRY_DSN` in the web build/runtime environment (`apps/web/.env.example`).
- Admin: `NEXT_PUBLIC_SENTRY_DSN` in the admin build/runtime environment (`apps/admin/.env.example`).
- Mobile: `EXPO_PUBLIC_SENTRY_DSN` in the Expo build environment (`apps/mobile/App.tsx`).

An empty DSN disables that app's SDK. Keep DSNs separate by project; web and admin variables are public client configuration, so use only their Sentry project DSNs. Event hooks remove user identity, request bodies, headers/cookies, query strings and PII-like email/mobile/token values before sending.

## Android preview APK (M11.11)
- Cloud build: `pnpm dlx eas-cli build --platform android --profile preview` (run from `apps/mobile`).
- Local build (requires Android SDK and local EAS build prerequisites): `pnpm dlx eas-cli build --platform android --profile preview --local` (run from `apps/mobile`).
- `preview` produces an installable APK for internal testers. Do not use the production profile for this tester distribution; it produces an AAB for a later release.
- Bump `expo.version` in `apps/mobile/app.json` for the human-readable version and increment `expo.android.versionCode` for every Android binary. Add a dated entry to `apps/mobile/CHANGELOG.md`.
- To require an update, update the `mobile.minSupportedVersion` Setting to the new minimum version (for example, `2.0.0`). Admin does not currently expose this setting, so run this SQL against the production database: `INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('mobile.minSupportedVersion', '"2.0.0"'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now();`. The API serves it from `/api/mobile/version`; the mobile app blocks versions lower than that value.

## Native Razorpay checkout (M11.4)
- `react-native-razorpay` includes native Android code and cannot run in Expo Go. Build/install an EAS development client after adding or upgrading the SDK: `pnpm dlx eas-cli build --platform android --profile development` from `apps/mobile`, then start Metro with `pnpm exec expo start --dev-client` and open the installed development client.
- For checkout testing, set the API's Razorpay public/secret keys and webhook secret to test credentials. The app requests the order from the API; the server webhook is authoritative, and the app waits for the payment endpoint to return `PAID`. Use the existing mock checkout in local development when Razorpay keys are absent. UPI intent availability depends on Razorpay account configuration and an installed UPI app on the Android device.

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

## Backups and restore (M12.10)

### Local backup scripts
Install the PostgreSQL client tools (`pg_dump`, `pg_restore`, `psql`, `createdb`, `dropdb`) and `tar`. Set `DATABASE_URL` and `UPLOAD_DIR` in the environment without echoing them. `scripts/backup/backup.sh` creates paired UTC-stamped custom-format database dumps and upload archives under `BACKUP_DIR` (default `./backups`) and removes matching archives older than 14 days. Override retention with `--retention-days N` and output location with `--output-dir DIR`.

Restore requires explicit destinations: `scripts/backup/restore.sh --database '<target database URL>' --uploads '<target folder>' --backup-dir '<backup folder>'`. It restores the latest matching pair, replacing the target database contents and files in the target folder. The script refuses an exact match with the current `DATABASE_URL` and a target folder matching `UPLOAD_DIR` unless `--force` is provided; use a separate target database and folder for drills. Protect dumps and archives as sensitive production data (they contain personal records), restrict filesystem access, and encrypt them at rest and in transit when copied off-host.

`scripts/backup/verify-restore.sh` makes a local backup, creates a uniquely named temporary database, restores the dump and upload archive, compares the row count of every public table (except Prisma's migration bookkeeping table), then drops the temporary database on success or failure. Run it after database migrations and at least monthly. Keep and review its output. A first local launch attempt found stale PostgreSQL shared memory; after restoring the local PostgreSQL service, the drill passed. Real output (19-Oct-2026):

```text
Backup created: /var/folders/z5/_nfgzfm13z3fctl6lgbkvss80000gn/T/tmp.Lz112d8pA0/backup/database-20261019T123529Z.dump and /var/folders/z5/_nfgzfm13z3fctl6lgbkvss80000gn/T/tmp.Lz112d8pA0/backup/uploads-20261019T123529Z.tar.gz
Application=34 ApplicationDocument=1 ApplicationStageHistory=73 AuditLog=14610 AvailabilitySlot=0 Banner=0 BlogCategory=6 BlogPost=0 BlogPostCategory=0 Booking=0 BookingStatusHistory=0 BusinessEntity=13 Category=16 Certificate=49 CertificateLookup=412 CertificateSequence=1 CertificationBody=50 CmsPage=4 Consultant=1 ConsultantDocument=0 ConsultantFeeChangeRequest=0 ConsultantService=0 Conversation=28 Coupon=3 CouponRedemption=1 CreditNote=6 CreditNoteSequence=1 CustomerProfile=61 DataRequest=0 DeviceToken=0 FinalDeliverable=0 InternalNote=0 Invoice=14 InvoiceSequence=1 Lead=2 Message=0 MessageAttachment=0 Notification=118 NotificationDelivery=315 NotificationTemplate=125 Order=28 OrderItem=28 OtpCode=7862 Payment=24 PaymentWebhookEvent=25 Permission=21 RefreshToken=722 Refund=9 Reminder=367 Review=0 Role=5 RolePermission=33 SearchQuery=5 Service=75 ServiceDocumentRequirement=279 ServiceFAQ=200 ServiceFormSchema=77 ServicePackage=205 ServiceRelation=219 ServiceStage=388 Setting=11 StoredFile=5 Subcategory=2 Tag=0 Testimonial=3 Ticket=0 User=324 UserRole=284 _BlogPostToTag=0
Verified row counts for 69 tables; temporary database will be dropped.
```

### Production AWS plan — to do at M12.9
- **RDS:** enable automated daily backups with 35-day retention and point-in-time recovery (PITR); monitor backup completion and copy snapshots cross-region/account per the approved recovery plan.
- **Uploads:** store production uploads in S3 with versioning enabled, lifecycle rules for noncurrent versions and retention aligned with the RDS recovery window; deny public access and use encryption.
- **Monthly restore drill:** restore an RDS snapshot to an isolated instance, restore a representative S3 version into an isolated bucket/prefix, point a staging build at them, run smoke checks and row/file consistency checks, record duration and gaps, then delete the temporary resources.
- **Escalation:** page the BizNexa production on-call/application owner first; the incident lead contacts the AWS account owner and AWS Support for RDS/S3 recovery issues. Confirm named people, phone numbers and support-plan details during M12.9 before production.
- **AWS setup remains pending M12.9.** The scripts here provide local backup/restore tooling only; they do not schedule production backups or configure AWS services.

## PDF generation (M3.22, D49)
Invoices and certificates are rendered from HTML by a `pdf` queue job with headless Chromium (`playwright-core`) and stored under `UPLOAD_DIR` like uploads; the record keeps the storage key (`Invoice.pdfKey`).
- Production: `PDF_RENDERER=playwright` (the default; `stub` is refused). The API image installs Chromium's headless shell and its system libraries (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). Allow ≈300 MB of memory per API instance for it; one browser is shared, two renders at a time.
- Development: install Chromium once with `pnpm --filter @biznexa/api exec playwright-core install chromium --only-shell` (the web E2E install covers it on the same Playwright version), or set `PDF_RENDERER=stub` for plain-text PDFs.
- Templates run with **no JavaScript and no network**: anything a template needs (logo, fonts, QR codes) must be inline (`data:` URLs, `<style>`). A broken image is a template bug, not an outage.
- Failures retry with backoff (≈1 min in all), then go to the `dead-letter` queue. Restarting the API queues every record still without a PDF, so after fixing Chromium a restart is enough.
- After upgrading `playwright-core`, rebuild the image (the Chromium build is tied to the version).
- **Invoice PDFs** (M3.23, D50) are made seconds after `invoice.issued`. To reprint one after a template or font change, clear its key (`UPDATE "Invoice" SET "pdfKey" = NULL WHERE number = 'BN/2627/000123'`) and either restart the API or have the customer click "Download invoice" again (a 409 queues it). The old file stays under `UPLOAD_DIR`; delete it by its old key if needed. Invoices are printed from the row as issued, so a Settings change never alters an existing invoice.

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

## Notifications (M6.3, D59)
- Every notification × channel is a row in `NotificationDelivery` and a `notifications` queue job. Admin → **Notification log** shows status per row; **Retry** sends a FAILED one again (audited).
- Temporary failures retry 6 times (30 s, 2 min, 8 min, 32 min, 1 h); permanent ones (no email/mobile, SMS template without DLT id, provider refused) fail at once — fix the cause, then Retry.
- Delivery reports: set `MSG91_WEBHOOK_TOKEN` and point MSG91's delivery report URL to `https://<api>/api/notifications/callbacks/msg91?token=<token>`; enable SendGrid's **signed** Event Webhook (delivered, bounce, dropped) to `https://<api>/api/notifications/callbacks/sendgrid` and put its verification key in `SENDGRID_WEBHOOK_PUBLIC_KEY`. Without them emails/SMS stay SENT.

## Scheduled jobs
- 00:05 IST daily — mark certificates past `validUntil` as EXPIRED (`CertificatesService.expireCertificates`).

## Secrets (API)
`JWT_ACCESS_SECRET`, `OTP_PEPPER`, `CERT_QR_SECRET`, `FILE_LINK_SECRET`, `DATA_ENCRYPTION_KEY` — 32+ random characters each in production. **Never rotate `DATA_ENCRYPTION_KEY`** once data exists: it encrypts staff 2FA secrets (and PAN later), which become unreadable — every staff member would need `reset-2fa`. Keep it in the secrets manager and its backups. Rotating `FILE_LINK_SECRET` only breaks download links issued in the last 5 minutes. Rotating `CERT_QR_SECRET` invalidates the "genuine QR" check on already-printed certificates (lookups still work), so rotate only if leaked.
