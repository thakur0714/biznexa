# Jules — progress log

Running log of what Jules has been given, what came back, and what to check before merging.
Rules and queue live in [JULES.md](JULES.md); step details in [ROADMAP.md](ROADMAP.md).

## Status

| Batch | Steps | State | PR |
|---|---|---|---|
| J1 | M3.24 | Old task **paused — do not resume**. Run again as a new task after J2 is merged. | — |
| J2 | M4.9, M4.7, M4.10, M4.16 | First task looped (12–13 Oct), nothing pushed. **Restarted 13-Oct-2026** as a new task with the "J2 full prompt" below, branch `jules-j2`. | not yet |
| J3 | M7.2, M7.1, M4.15 | Waiting for J2 + J1 | — |
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
