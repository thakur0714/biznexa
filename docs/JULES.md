# Jules — unattended work on the roadmap

`docs/ROADMAP.md` stays the only source of truth for what each step is. This file only says
**how** Jules works without supervision and **which** steps it may take, in which order.

Task prompt to give Jules (change only the batch name):

```
Follow docs/JULES.md exactly. Do batch J2.
```

---

## 1. Rules for Jules

You are working on the BizNexa monorepo (pnpm + Turborepo; NestJS API in `apps/api`, Next.js
apps in `apps/web` and `apps/admin`, shared code in `packages/*`). Nobody is watching while you
work. Work through the steps of your batch in the listed order, **one step at a time**. The
protocol below replaces any approval waits — do not wait for plan approval, but do stop when a
rule says STOP.

### Phase 0 — Environment check (once per task, no file changes allowed)
Run and record the output of each:
```
node -v                      # must be v22.x
pnpm -v                      # must be 10.28.x
pg_isready -h localhost      # Postgres must accept connections
redis-cli ping               # must answer PONG
pnpm install --frozen-lockfile
pnpm --filter @biznexa/types build
cd apps/api && npx prisma generate && npx prisma migrate deploy && npx tsx prisma/seed.ts
```
If **any** of these is missing or fails → **STOP the whole task.** Do not create, edit or delete
any file. Do not work around it by changing code, config, `package.json`, the lockfile, tests or
migrations. Report which command failed, its error output, and what must be installed.

### Phase 1 — Baseline tests (once per task, no file changes allowed)
```
pnpm --filter @biznexa/types test
pnpm --filter @biznexa/ui test
pnpm --filter @biznexa/admin test
cd apps/api && npx tsc -p tsconfig.json --noEmit && npx jest
```
Record pass/fail counts. If the baseline is not green → **STOP the whole task** and report the
failing tests. Do not fix them.

### For each step in the batch

**A. Check it may start.** The step is `[ ]` in `docs/ROADMAP.md`, every step listed under
"Needs" for it in the queue below is `[x]`, and the step is not tagged `[Opus]`. If not → STOP
the batch and report.

**B. Read before coding.** In full: `AGENTS.md`; the "How to run a step" protocol, the
self-review checklist, the step itself and the follow-ups of the steps it builds on in
`docs/ROADMAP.md`; every `docs/PROMPT.md` section the step references (`Ref: §…`);
`docs/DECISIONS.md`; `docs/ER.md` and the Prisma models it touches; the existing code and tests
of the modules it touches, plus one finished similar module, so you copy its patterns (zod
schemas in `packages/types`, `@ZodBody`/`@ZodQuery`, `@RequirePermissions`, audit log, domain
events, state machine, test style).

**C. Plan.** Write 3–8 bullets: files, endpoints, schema/migration changes, shared types, tests
you will add. Keep it in your final report. If the plan touches more than ~10 files or two
modules, or anything essential is ambiguous or contradicts `docs/DECISIONS.md` → STOP the batch
and report your questions. Never guess on money, GST, payments, permissions or data rules.

**D. Build in slices: build → test → build → test.** Split the plan into small slices (shared
types → API service → controller → UI). For each slice: write the code, write its tests in the
same slice, run that package's tests and typecheck, and only move on when green. If a test fails,
fix the code, not the test (unless the test is wrong — then explain why). If the same failure
happens twice and you are not sure of the cause → STOP the batch and report.

**E. Full verification (same as CI).**
```
pnpm typecheck
pnpm lint
pnpm --filter @biznexa/types test
pnpm --filter @biznexa/ui test
pnpm --filter @biznexa/admin test
cd apps/api && npx tsc -p tsconfig.json --noEmit && npx jest
pnpm --filter @biznexa/api-client generate    # if the API changed; commit the result
pnpm --filter @biznexa/api build && pnpm --filter @biznexa/web build && pnpm --filter @biznexa/admin build
```
All green, or → STOP the batch and report. Never claim a command passed without running it.

**F. Self-review and record.** Go through the self-review checklist in `docs/ROADMAP.md` item by
item. Tick the step in `docs/ROADMAP.md` with a `*Done <DD-Mon-YYYY>:*` note and `*Follow-ups:*`
in the same style as earlier steps. Add choices the spec didn't cover to `docs/DECISIONS.md`
(next D-number).

**G. Commit and push.** One commit per step: `M4.9 — Rejection presets`. Push the branch to
GitHub right after each step's commit, so finished work is never lost. Then go to the next step.
Open the pull request only at the end.

### Hard rules (every phase)
- Only the steps of your batch. No "while I'm here" refactors or changes in other modules.
- Never delete, skip (`.skip`/`.only`/`xit`), weaken or comment out existing tests.
- Never edit an existing migration; add a new folder in the same naming style.
- No new, removed or upgraded dependencies unless the step clearly needs it; say which and why,
  and keep `pnpm-lock.yaml` in sync.
- Money in integer paise; GST/coupon maths only through `packages/types` helpers.
- Authorization in the API, not only the UI. `PERMS.ADMIN_ACCESS` only means "may log in to the
  admin portal" (every staff role has it) — never use it as a permission check. Users with only
  `applications.view_assigned` may touch an application (and its documents, notes, messages)
  only when `Application.assignedToId` is their id; otherwise 404.
- No hard-coded services, prices, stages, documents or form fields.
- No secrets, real keys or `.env` files in commits. No PII in logs.
- Never take an `[Opus]` step, even if it looks easy.
- "Tests pass" is not a result. Always give the exact command and its pass/fail counts, and never
  call a step complete while its tests are still failing or not yet run.
- Never change or remove an existing transition, schema field or API response; only add. If a
  step seems to need it, STOP and report.
- Stopping with a clear report is always better than a guess.
- Never ask "is there anything else" or wait for confirmation — nobody replies until the PR.
- Create your branch once. Never reset, recreate or force-push it, and never discard finished
  steps. If you get new instructions mid-task, apply them on top of the existing work.
- Never print, log or commit a GitHub token, and never put it in the PR description.

### Final report (always, also after a STOP)
1. Phase 0 and Phase 1 output (with test counts)
2. Per step: status (done / stopped / not started), plan, files changed, tests added and what
   each proves, self-review results, follow-ups
3. Where and why you stopped, and the questions you need answered
4. Final test counts

---

## 2. Queue

`[Opus]` steps (money, payments, state machines, authorization, security) are **not** given to
Jules — they are done and reviewed in a supervised session. Jules batches wait for them where
listed under "Needs".

| Batch | Steps, in order | Needs (must be `[x]` first) |
|---|---|---|
| J1 | M3.24 | — |
| J2 | M4.9, M4.7, M4.10, M4.16 | — |
| J3 | M7.2, M7.1, M4.15 | — |
| J4 | M4.3, M4.4, M4.5, M4.6 | M4.1, M4.2 (supervised) |
| J5 | M4.8, M4.11, M4.12, M4.14 | J4, M4.7 |
| J6 | M4.17 | J5, M4.13 (supervised) |

Supervised (not for Jules) in this range: **M4.1, M4.2, M4.13**. Batches for M5+ are added here
once M4 is merged.

Start the next batch only after the previous batch's PR is reviewed, tested locally and merged.

---

## 3. Environment setup script

Paste into Jules → repo → Configuration → Setup script. Values match `.github/workflows/ci.yml`.

```bash
set -e
sudo apt-get update
sudo apt-get install -y postgresql redis-server
sudo service postgresql start
sudo service redis-server start
sudo -u postgres psql -c "CREATE USER biznexa WITH PASSWORD 'biznexa' CREATEDB;" || true
sudo -u postgres psql -c "CREATE DATABASE biznexa OWNER biznexa;" || true

node -v
corepack enable
corepack prepare pnpm@10.28.0 --activate
pnpm install --frozen-lockfile

cat > apps/api/.env <<'EOF'
NODE_ENV=test
DATABASE_URL=postgresql://biznexa:biznexa@localhost:5432/biznexa?schema=public
JWT_ACCESS_SECRET=ci-access-secret-0123456789abcdef0123456789
OTP_PEPPER=ci-otp-pepper-0123456789
CERT_QR_SECRET=ci-qr-secret-0123456789abcdef0123456789
FILE_LINK_SECRET=ci-file-link-secret-0123456789abcdef0123
DATA_ENCRYPTION_KEY=ci-data-encryption-key-0123456789abcdef0123
API_URL=http://localhost:4000
REDIS_URL=redis://localhost:6379
PAYMENT_GATEWAY=mock
VIRUS_SCANNER=stub
PDF_RENDERER=playwright
EOF

pnpm --filter @biznexa/types build
(cd apps/api && npx prisma generate && npx prisma migrate deploy && npx tsx prisma/seed.ts)
# Chromium for PDF and E2E tests (the slowest part — needed for M3.24 and PDF steps)
(cd apps/api && node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium)
```
