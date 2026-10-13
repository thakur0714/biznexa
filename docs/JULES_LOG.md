# Jules — progress log

Running log of what Jules has been given, what came back, and what to check before merging.
Rules and queue live in [JULES.md](JULES.md); step details in [ROADMAP.md](ROADMAP.md).

## Status

| Batch | Steps | State | PR |
|---|---|---|---|
| J1 | M3.24 | Old task **paused — do not resume**. Run again as a new task after J2 is merged. | — |
| J2 | M4.9, M4.7, M4.10, M4.16 | **Running** (started 12-Oct-2026). Jules reports M4.9, M4.7 done, M4.10 tests still being fixed, M4.16 next. | not yet |
| J3 | M7.2, M7.1, M4.15 | Waiting for J2 + J1 | — |
| J4 | M4.3–M4.6 | Waiting for M4.1, M4.2 (supervised, Claude) | — |

Supervised steps to do with Claude (not Jules): **M4.1, M4.2, M4.13**.

## Check on the J2 PR before merging

- [ ] Branch checked out locally; `pnpm typecheck && pnpm lint && pnpm test` green; api-client not stale.
- [ ] PR description has the real test commands and pass/fail counts for every step.
- [ ] **M4.7:** no existing transition in `packages/types/src/status.ts` was changed or removed
      (the M3.10 upload flow uses it) — only additions; old tests still pass unchanged.
- [ ] **Nowhere is `PERMS.ADMIN_ACCESS` used as an authorization check** (`grep -rn ADMIN_ACCESS apps/api/src`).
      It only means "may log in to the admin portal" — every staff role has it (seed-access.ts).
- [ ] **M4.9:** `PUT /api/admin/settings/rejection-presets` requires `SETTINGS_MANAGE`;
      PUT writes an audit log; presets not hard-coded; zod schema in `packages/types`.
- [ ] **M4.10:** M4.10 integration tests actually pass (Jules was still fixing them); customer
      API never returns internal notes; staff writes audit logged.
- [ ] **M4.10 scoping:** user with only `applications.view_assigned` can use notes only where
      `Application.assignedToId === user.id` — on every endpoint (list, create, update, delete).
      Not visible → 404; someone else's note without `view_all` → 403; "manage all" =
      `APPLICATIONS_VIEW_ALL` only. Tests: unassigned ops → 404, assigned ops → own note ok /
      other's note 403, admin deletes any, customer never sees notes, support → 403.
- [ ] **M4.16:** requires `AUDIT_VIEW`; filters (actor, entity, date) validated; before/after diff view.
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
