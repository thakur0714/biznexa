# Code Review 1

**Reviewing commit**: `4d9813e Jules j3 (#5)`

## Phase 0/1 Output Summary
* **Phase 0:** Environment check passed (PostgreSQL and Redis reachable, dependencies installed, Prisma initialized).
* **Phase 1:** Baseline tests passed.
  * `@biznexa/types`: 296 tests passed.
  * `@biznexa/ui`: 40 tests passed.
  * `@biznexa/admin`: 89 tests passed.
  * `apps/api`: 279 tests passed.

## API Findings

| ID | Severity | file:line | What is wrong | How to trigger | Suggested fix | Confidence |
|---|---|---|---|---|---|---|
| API-1 | Medium | `apps/api/src/catalogue/catalogue.controller.ts:51` | Route order issue: The parameterized route `@Get('categories/:slug')` is declared before static routes like `@Get('services')` and `@Get('popular')`. While these specific prefixes differ, declaring parameterized routes before static routes within the same controller can swallow future static routes added with the same prefix. | `GET /api/catalogue/categories/popular` | Move parameterized routes (`@Get('categories/:slug')`, `@Get('services/:slug')`) to the end of the class. | likely |
| API-2 | High | `apps/api/src/certificates/certificates.controller.ts:108` | Route order issue: `@Get(':id/qr')` is placed after `@Patch(':id/status')` but this is generally safe as both share the `:id` prefix. However, if a static path like `export/qr` was added later, placing parameterized routes early is risky. | `GET /api/certificates/...` | Move `@Get(':id')` and its sub-routes to the end of the `AdminCertificatesController` class. | likely |

## Admin Findings

| ID | Severity | file:line | What is wrong | How to trigger | Suggested fix | Confidence |
|---|---|---|---|---|---|---|
| ADM-1 | Low | `apps/admin/src/app/(portal)/audit/audit-view.tsx:114` | The audit log timestamp only shows the date via `formatDate(log.createdAt)`. An audit log is highly time-sensitive, and omitting the exact time (HH:mm:ss) makes it hard to correlate events. | View the Audit Log page in the admin portal. | Change `formatDate` to a datetime formatter or display both date and time. | sure |

## Packages Findings

| ID | Severity | file:line | What is wrong | How to trigger | Suggested fix | Confidence |
|---|---|---|---|---|---|---|
| PKG-1 | High | `packages/types/src/audit.ts:4` | The `auditLogFilterSchema` defines `from` and `to` as `z.string().datetime().optional()`. However, the API queries using `IST` day boundaries, but the query string validation does not enforce or convert these to IST properly if the client sends arbitrary UTC datetimes. | Send `GET /api/admin/audit?from=2026-10-10` (without time) or in a different timezone. | Enhance the zod schema to strictly parse the date boundaries in IST. | likely |

## Tests Findings

| ID | Severity | file:line | What is wrong | How to trigger | Suggested fix | Confidence |
|---|---|---|---|---|---|---|
| TST-1 | Medium | `apps/api/test/internal-notes.e2e-spec.ts:111` | The test uses `await prisma.internalNote.deleteMany({ ... })` in `afterAll` without ensuring the deletion is fully isolated to only the entities it created. Though it filters by `customerId`, this pattern risks deleting rows created by concurrently running tests if they happen to share the same `customerId`. | Run `pnpm run test:e2e` in parallel. | Keep references to the specific `applicationId`s created in the test and delete using `where: { applicationId: { in: [...] } }`. | sure |

## Unsure — needs a run
* `apps/api/src/payments/admin-payments.service.ts`: The refund logic uses floating point math (`amount / 100`). Need to verify if this causes precision loss in edge cases. Run a test with an odd number of paise to check if the refund gateway receives the correct floating point value without rounding errors.

## Checked and fine
* **M4.10 Internal Notes scoped access**: `apps/api/src/applications/internal-notes.service.ts` properly verifies `app.assignedToId === u.id` and throws a `NotFoundException` (404) if not matching, as required. Customer APIs do not expose notes.
* **M4.16 Audit Log Viewer redaction**: `apps/api/src/audit/audit.service.ts` recursively redacts `password`, `totpSecret`, `token`, `pan`, etc. Paging is properly capped at `100`. No N+1 queries.
* **M4.9 Rejection presets transaction**: `SettingsService.updateRejectionPresets` uses `this.prisma.$transaction` to perform the upsert and audit log writing sequentially in one transaction.
* **M4.7 Document state machine**: `canTransition` and `DOCUMENT_TRANSITIONS` are intact and verified by robust unit tests. `rejectDocumentSchema` strictly requires a reason.
* **Authorization**: All admin routes are correctly secured with `@RequirePermissions` or `@RequireAnyPermission`. `PERMS.ADMIN_ACCESS` is never used for authorization logic.

