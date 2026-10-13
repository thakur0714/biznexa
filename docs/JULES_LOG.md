# Jules — progress log

Running log of what Jules has been given, what came back, and what to check before merging.
Rules and queue live in [JULES.md](JULES.md); step details in [ROADMAP.md](ROADMAP.md).

## Status

| Batch | Steps | State | PR |
|---|---|---|---|
| J1 | M3.24 | Jules wrote it (task errored after pushing); fixed and run locally by Claude, **merged 13-Oct-2026** (`7f8af1c`). | merged (#2) |
| J2 | M4.9, M4.7, M4.10, M4.16 | Done by Jules, verified locally, **squash-merged 13-Oct-2026** (`1d13f88`). ROADMAP ticked. | merged |
| J3 | M7.2, M7.1, M4.15 | Jules pushed all 3 steps, then failed to open the PR. Fixed + verified locally by Claude 13-Oct-2026. | PR from `jules-j3` |
| J4 | M4.3–M4.6 | Waiting for M4.1, M4.2 (supervised, Claude) | — |

Supervised steps to do with Claude (not Jules): **M4.1, M4.2, M4.13**.

## Check on the J2 PR before merging

- [ ] Branch checked out locally; `pnpm typecheck && pnpm lint && pnpm test` green; api-client not stale.
- [ ] PR description has the real test commands and pass/fail counts for every step.
- [ ] **M4.7:** reason required for → REJECTED (zod); new tests sit next to the existing ones in
      `core.test.ts`. No existing transition in `packages/types/src/status.ts` was changed or removed
      (the M3.10 upload flow uses it) — only additions; old tests still pass unchanged.
- [ ] **Nowhere is `PERMS.ADMIN_ACCESS` used as an authorization check** (`grep -rn ADMIN_ACCESS apps/api/src`).
      It only means "may log in to the admin portal" — every staff role has it (seed-access.ts).
- [ ] **M4.9:** no Prisma schema change (new `Setting` key only); GET allowed for
      `DOCUMENTS_REVIEW` or `SETTINGS_MANAGE`; `PUT /api/admin/settings/rejection-presets` requires `SETTINGS_MANAGE`;
      PUT writes an audit log; presets not hard-coded; zod schema in `packages/types`.
- [ ] **M4.10:** M4.10 integration tests actually pass (Jules was still fixing them); customer
      API never returns internal notes; staff writes audit logged.
- [ ] **M4.10 scoping:** user with only `applications.view_assigned` can use notes only where
      `Application.assignedToId === user.id` — on every endpoint (list, create, update, delete).
      Not visible → 404; someone else's note without `view_all` → 403; "manage all" =
      `APPLICATIONS_VIEW_ALL` only. Tests: unassigned ops → 404, assigned ops → own note ok /
      other's note 403, admin deletes any, customer never sees notes, support → 403.
- [ ] **M4.16:** requires `AUDIT_VIEW`; read-only; filters (actor, entity, action, date) validated
      by zod in `packages/types`; server-side paging (max 100); **new migration** with a
      `createdAt` index (none existed); no N+1 for actor names; **secrets redacted** in
      before/after (password, totpSecret, token, pan…) with a test; before/after diff view.
- [ ] No tests deleted, skipped or weakened; no changes outside the four steps; no edited migrations.
- [ ] ROADMAP ticked with Done notes; new DECISIONS entries make sense.

## Review notes

- **13-Oct, M4.9 (`ed2ff36`):** permissions, audit log, zod, no schema change — OK. New
  `@RequireAnyPermission` in `auth.guard.ts` — logic OK, additive. Missing: API integration tests
  (none in `apps/api/test/`), guard test, upsert + audit not in one transaction. Class-level
  `SETTINGS_MANAGE` moved to each method on `AdminSettingsController` — any future method there
  without a decorator would be open to every logged-in user. Squash the empty "trigger submit" commit.
- **13-Oct, local verification of `815c80d`** (separate DB `biznexa_j2`): typecheck ✅, lint ✅ (1 old
  warning in web), types 244 ✅, ui 40 ✅, admin 89 ✅, API 33 suites / 279 ✅, API + web + admin build ✅.
  Notes scoping correct (404 unassigned, 403 other's note, view_all manages all); audit viewer
  `audit.view`, paged, redacted. Follow-ups (not blockers): redaction matches exact keys only — add
  `panEnc`, `codeHash`, `tokenHash` (or match *secret*/*token*/*hash*; careful: `company` contains
  "pan"); notes `updatedAt` always equals `createdAt`; note/preset write + audit not in one
  transaction; unused imports in `internal-notes.controller.ts`; `(actorId)` index now redundant.
- **13-Oct, J1 (`jules-j1`):** Jules never ran the spec (code-only) and 6 things failed locally: it enabled
  2FA on the seeded admin (second run 403), shared the seeded customer (OTP resend wait between
  desktop/mobile), `fill` on a select, "Next" also matched the Next.js dev-tools button, waited for a
  success view the mock flow never reaches without reload, expected `APP-` codes (real: `BN…`).
  CHANGELOG had wrong claims and Playwright "passing" without a run. All fixed; no app code changed.
- **13-Oct, J3 (`jules-j3`):** 2 of its own integration tests failed (it cannot run them): expected 200
  for a user without the permission, and an unquoted CSV header. Real bugs: `GET :id` declared before
  `GET bodies` → the existing bodies list answered 400; CSV export read a token from `localStorage`
  that does not exist (always 401) and bypassed the same-origin `/api`; date filters sent as UTC
  midnights and not validated. No ROADMAP ticks. All fixed; full suite 296/296.
- Flaky since J2: `internal-notes.e2e-spec` creates its own category, and `app.e2e-spec`'s catalogue
  test can pick it as "other category" → one of them fails now and then in a full run. Fix: the
  catalogue test should create its own second category (or notes should not need a category).
- Test teardown: Jules deleted shared seeded rows (category) and broke other suites — tests must
  create and delete only their own data.

## What we learned about Jules

- It tends to stop and ask ("let me know…", "for your review") even when told not to. Reply
  "continue without waiting"; click "Approve plan" if Jules shows the button.
- It skipped Phase 0 / Phase 1 (environment check + baseline tests) on J2 until reminded.
- It reports "tests pass" without output or counts — always ask for the commands and counts.
- It calls a step "complete" while its tests are still being fixed — verify locally.
- It may pick up a different batch than asked (J2 instead of J1) — check the batch name in its first reply.
- Each new task clones the repo fresh; it does not need "git pull", but the prompt verifies the commit anyway.
- 13-Oct: in M4.10 it treated `ADMIN_ACCESS` as "is admin" (every staff role has it) and left out
  the assigned-application check — permission/scoping code needs a careful review every time.
- 13-Oct: after the new rules were pushed it recreated branch `jules-m4` and restarted all of J2
  from scratch, then got stuck in a reset/ask loop. Fix: close the task and start a new one with
  ALL requirements in one prompt (see "J2 full prompt" below), so it has nothing left to ask.
- Lesson: put every step-specific requirement in the first prompt. Corrections mid-task cause restarts.
- Repo is `thakur0714/biznexa`; Jules must be connected to an account with access to it.

## Prompts

New batch task:
```
Do not wait for my approval or replies at any point in this task. Nobody is watching.
Work through everything on your own and only stop where docs/JULES.md says STOP.

Step 1 — make sure you have the latest code:
  git fetch origin && git checkout main && git pull --ff-only origin main
  git log --oneline -1
  ls docs/JULES.md
docs/JULES.md must exist. If not, STOP and report the output. Do not change any file.

Step 2 — read docs/JULES.md fully and follow it exactly. Do batch <BATCH>.
- If the environment check (Phase 0) fails, STOP: do not write or change any code,
  only report what is missing.
- Do not stop to show me a plan; write the plan in your final report instead.
- Do not ask me questions mid-task. If something blocks you, STOP as docs/JULES.md
  says and put the question in the final report.
- For every step, report the exact test commands you ran and their pass/fail counts.
- Commit once per step. At the end (done or stopped), open a pull request to main
  with the full final report as the PR description.
```

When Jules stops to ask mid-task:
```
Nothing else — continue without waiting for me. Report the exact test commands and
pass/fail counts for every step. Stop only where docs/JULES.md says STOP, then open
the pull request to main with the full final report.
```

J2 full prompt (13-Oct-2026 — all requirements up front, nothing left to ask):
```
Do not wait for my approval or replies at any point. I will not reply until you open a pull
request. Never ask "is there anything else" — just continue. Never reset or recreate your
branch once you have started.

Step 1: git fetch origin && git checkout main && git pull --ff-only origin main
        git log --oneline -1 ; ls docs/JULES.md docs/JULES_LOG.md
        Create ONE branch jules-j2 from main. If the files are missing, STOP and report.

Step 2: Read docs/JULES.md fully and follow it exactly. Do batch J2: M4.9, M4.7, M4.10, M4.16,
in that order. Phase 0 (environment) and Phase 1 (baseline tests) first, with real output;
if either fails, STOP without changing any file.

Step-specific requirements (these are final, do not ask about them):

M4.9 Rejection presets
- No Prisma schema change: store "rejection.presets" as a new key in the Setting table.
- GET allowed for PERMS.DOCUMENTS_REVIEW or PERMS.SETTINGS_MANAGE; PUT requires
  SETTINGS_MANAGE and writes an audit log (before/after).
- zod schema in packages/types: non-empty trimmed strings, no duplicates, sensible max
  length and count. Admin UI page to edit the list.

M4.7 Document state machine
- DOCUMENT_TRANSITIONS already exists in packages/types/src/status.ts — keep it unchanged.
- Add tests next to the existing ones in packages/types/src/core.test.ts for every allowed
  and every forbidden move.
- A move to REJECTED requires a non-empty reason (zod schema in packages/types).

M4.10 Internal notes
- PERMS.ADMIN_ACCESS is NOT an authorization signal (every staff role has it).
- "Manage all notes" = PERMS.APPLICATIONS_VIEW_ALL only.
- Users with only applications.view_assigned may use notes only where
  Application.assignedToId === user.id, on every endpoint (list, create, update, delete).
  Application not visible → 404. Editing/deleting someone else's note without view_all → 403.
- Customer APIs never return notes. Staff writes are audit logged.
- Integration tests: unassigned ops → 404 on list and create; assigned ops → list/create ok,
  delete own ok, other's note 403; admin deletes any; customer never sees notes; support → 403.

M4.16 Audit log viewer
- Every endpoint requires PERMS.AUDIT_VIEW. Read-only.
- Server-side pagination: default 50, max 100, newest first.
- Filters (actorId, entityType, entityId, action, from/to with IST day boundaries) validated
  with zod in packages/types.
- NEW migration adding an index on createdAt and on (actorId, createdAt). Never edit existing
  migrations.
- No N+1: select actor name/email in the list query.
- Redact secrets in before/after on every response: recursive (nested objects and arrays),
  case-insensitive key match (password, passwordHash, totpSecret, twoFactorSecret, secret,
  token, accessToken, refreshToken, pan). Tests include a nested case.
- UI: filters in the URL, loading/empty/error states, before/after diff of changed keys,
  works at 360px.
- Tests: AUDIT_VIEW user can list/filter; users without AUDIT_VIEW → 403; paging and date
  filter correct; redaction.

Step 3: One commit per step. Run the full verification from docs/JULES.md and report every
command with pass/fail counts. Open a pull request to main with the full final report as the
description. If something blocks you, STOP and put the question in the PR description.
```

Same-task restart (when Jules loops; send in the same window):
```
STOP asking questions. Nothing else needs to be confirmed. I will not reply again until you
open the pull request — any question you ask will stay unanswered and waste the task.

Do exactly this, once, in order:
1. Sync ONE last time: git fetch origin && git checkout main && git pull --ff-only origin main
   Then create branch jules-j2 from main. From now on never reset, recreate or force-push it,
   and never start over. If you get stuck, STOP and write the problem in the final report.
2. Re-read docs/JULES.md (it has new rules: push after every step, never ask, never reset)
   and the "J2 full prompt" at the end of docs/JULES_LOG.md. Those are all the requirements.
3. Environment: if Postgres, Redis, pnpm or Chromium are missing, run the setup script in
   docs/JULES.md section 3 (system packages + git-ignored apps/api/.env only). If setup fails,
   STOP and report — do not change any tracked file.
4. Phase 0 and Phase 1 with real output and test counts.
5. M4.9 → M4.7 → M4.10 → M4.16. After each step: tests green, one commit, then
   git push origin jules-j2 right away.
6. Full verification from docs/JULES.md with every command and its pass/fail counts.
7. Open the pull request to main with the full final report as the description.

Use the GitHub token only for git authentication. Never print it, never put it in a file,
commit, log, command output or the PR description.
Start now.
```

J1 full prompt (M3.24 — code-only mode, 13-Oct-2026):
```
Do not wait for my approval or replies at any point. I will not reply until you open a pull
request. Never ask "is there anything else" — just continue. Create branch jules-j1 from the
latest main once; never reset, recreate or force-push it. Push after every commit.
Use the GitHub token only for git authentication; never print it or put it in any file,
commit, log or the PR description.

Read docs/JULES.md fully and follow it — it is in CODE-ONLY MODE: write code and tests, run
typecheck, lint and unit tests only. Do NOT install or start Postgres, Redis, the API, the web
app or Playwright, and do not run next build. I run all of that locally.
Batch J1 = step M3.24 only.

M3.24 requirements (final, do not ask about them):
- One new Playwright spec in apps/web/e2e/ (next to smoke.spec.ts, same style, role/label
  selectors, no fixed sleeps) for the full order journey: customer logs in with mobile OTP
  (in development the OTP is shown on screen — see the smoke.spec.ts header comment) → opens a
  seeded service → picks a package → fills the form → uploads a small PDF → applies a coupon →
  pays with the MOCK gateway → sees the success view with the Application ID.
- Mock payments open no payment window (see payment-step.tsx "Test mode"). Complete the
  payment from the test the same way the API tests do: a webhook signed like the mock gateway
  (see apps/api/test/payment-webhook.e2e-spec.ts and apps/api/src/payments/mock-payment-gateway.ts).
  Do not add any test-only endpoint or shortcut to the API or web code.
- No coupon is seeded: create one in the test through the admin API (admin demo login from
  the seed), with a unique code. Do not change seed data.
- Every record the test creates uses unique values; never delete or edit seeded rows.
- Written to work on both Playwright projects (desktop and mobile) in playwright.config.ts.
- Do not change application code. If reading the code shows the journey cannot work because
  of a real bug, describe it in the PR — do not work around it.
- Since you cannot run it: read every page and component the journey passes through and make
  sure each selector matches the real label/role/text in the code. List them in the PR.
- Update docs/CHANGELOG.md with a Milestone 3 summary in the style of the existing entries,
  and tick M3.24 in docs/ROADMAP.md.

Finish with the static verification from docs/JULES.md (typecheck, lint, unit tests) with
pass/fail counts, then open the pull request to main. In the PR write clearly:
"E2E not run — to be run locally".
```

J3 full prompt (M7.2, M7.1, M4.15 — code-only mode, 13-Oct-2026):
```
Do not wait for my approval or replies at any point. I will not reply until you open a pull
request. Never ask "is there anything else" — just continue. Create branch jules-j3 from the
latest main once; never reset, recreate or force-push it. Push after every commit.
Use the GitHub token only for git authentication; never print it or put it in any file,
commit, log or the PR description.

Step 1: git fetch origin && git checkout main && git pull --ff-only origin main
        git log --oneline -1 ; ls docs/JULES.md docs/JULES_LOG.md
        If the files are missing, STOP and report.

Step 2: Read docs/JULES.md fully and follow it — it is in CODE-ONLY MODE: write code and tests,
run typecheck, lint and unit tests only. Do NOT install or start Postgres, Redis, the API, the
web/admin apps or Playwright, and do not run next build. I run all of that locally.
Batch J3 = M7.2, M7.1, M4.15, in that order. Phase 0 and Phase 1 first, with real output.

Step-specific requirements (final, do not ask about them):

Common to all three
- Admin UI goes in apps/admin, copying the coupons pages (app/(portal)/coupons) and
  components/data-table.tsx: loading / empty / error states, filters in the URL, works at 360px.
- When a page is built, add `built: true` to its item in apps/admin/src/lib/nav.ts (keep the
  existing slugs "certificates" and "payments") and update nav.test.ts if it counts built items.
- New zod schemas in packages/types; API uses @ZodBody/@ZodQuery; OpenAPI + api-client
  regenerated (pnpm --filter @biznexa/api-client generate) and committed.
- Every staff write is audit logged (before/after), like the coupons module.
- API integration tests in apps/api/test/ in the style of admin-coupons.e2e-spec.ts, using
  test/staff.ts for staff sessions. Tests create and delete only their own rows — never touch
  seeded rows. You cannot run them: write "not run, to be run locally".
- Existing endpoints and response shapes stay as they are; only add.

M7.2 Certification bodies CRUD (model CertificationBody already exists — no schema change)
- Endpoints under /api/admin/certificates/bodies, all PERMS.CERTIFICATES_MANAGE: keep the
  existing GET; add POST, PATCH /:id, DELETE /:id.
- Fields: name (required, trimmed, unique → 409 with a clear message), accreditation
  (optional), website and logoUrl (optional, https:// URLs only). Logo is a URL field — no file
  upload (stored files are private; there is no public image hosting yet).
- DELETE refuses with 409 when any certificate uses the body; otherwise deletes.
- Admin UI: a "Certification bodies" page reachable from the certificates section (list, add,
  edit, delete with confirm).
- Tests: create, duplicate name 409, edit, delete unused, delete used → 409, non-https URL 400,
  user without certificates.manage → 403.

M7.1 Admin certificate UI (API exists: GET /api/admin/certificates, POST, PATCH /:id/status,
GET /:id/qr, GET /:id/lookups — read certificates.controller.ts and certificates.service.ts)
- Only one API addition allowed: GET /api/admin/certificates/:id (CERTIFICATES_MANAGE, 404 when
  missing) returning the certificate with its body name and lookup count. Add a test for it.
- Pages at /certificates: list (search + status filter, paging as the API does), create form
  (body picker from the bodies endpoint, dates, the API's validation messages shown per field),
  detail (all fields, QR image, status change with a required reason — use the transitions the
  service already allows, do not change them — and the lookups table).
- Do not build PDF upload/generation (that is M7.3).
- Unit tests in apps/admin for the status-change form (reason required) and the create form
  validation.

M4.15 Payment management (admin) — READ-ONLY
- Refund actions are NOT part of this batch: refunds are M4.13, a supervised [Opus] step. Show
  existing Refund rows read-only; no refund buttons, endpoints or gateway calls. Do not change
  payment status anywhere.
- New controller /api/admin/payments, PERMS.PAYMENTS_VIEW on every route:
  - GET list: filter status group (all | success | failed | pending — pending = CREATED or
    PENDING; refund statuses count as success-group only under "all"), date range (paidAt or
    createdAt), search by order code, application code or customer email/mobile; server-side
    paging (default 25, max 100), newest first; no N+1 (one query with the joins needed).
  - GET /:id: payment with order code, application code, customer name/email, method,
    gateway ids, amounts, failure reason, refunds (read-only) and invoice summary (id, number,
    issuedAt). Never return rawWebhook.
  - GET export CSV with the same filters (max 10,000 rows, 400 above that), columns: created,
    paid, order code, application code, customer name, customer email, amount (₹ with 2
    decimals from integer paise), status, method, gateway payment id, invoice number.
    Guard against CSV injection (prefix cells starting with = + - @ with a single quote).
    Content-Type text/csv, filename payments-YYYY-MM-DD.csv.
- Invoice download in the UI uses the existing POST /api/invoices/{id}/link (it already allows
  payments.view) — do not add another download route.
- Admin UI at /payments: list with status tabs, filters, "Export CSV", detail page.
- Tests: PAYMENTS_VIEW user lists/filters/details; user without it → 403; rawWebhook never in
  any response; CSV has the header, escapes a "=cmd" customer name, amounts in rupees; paging.

Finish with the static verification from docs/JULES.md (typecheck, lint, unit tests, api tsc,
api-client generate) with pass/fail counts. One commit per step, pushed right away. Then open
the pull request to main with the full final report. In the PR write clearly:
"API integration tests and the admin UI not run — to be run locally".
```
