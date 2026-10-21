# Sonar fixes: task guide for AI agents

The SonarQube for IDE extension (VS Code) reports about 1,500 warnings across the repo. This guide splits the
clean-up into small tasks that don't touch the same files, so several agents can work at once. Each task has a
copy-paste prompt at the end.

**Base branch:** `main`. The old `sonar-fixes` branch was merged into `main` and deleted on 21-Oct-2026. Branch every task from `main`.

---

## 1. Rules every agent follows

1. **Do only your task's files.** The task table lists the folders. Don't edit anything outside them, not even "while you're there". Another agent owns those files.
2. **Behaviour must not change.** These are code-quality fixes. Same output, same API responses, same UI, same error messages and the same order of events. If a fix would change behaviour, don't make it. List it under "Skipped" in your final message.
3. **Use the fix catalogue (section 4).** It has the agreed fix for each rule. Don't invent other patterns.
4. **`// NOSONAR` only in the cases section 5 allows**, and always with a reason on the same line or the line above it.
5. **Don't touch:** `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, ESLint configs, generated files (`apps/api/src/generated/**`), migrations, `.env*`.
6. **Git:** create your branch, make **one commit for the task** and push the branch. No rebase, reset, cherry-pick or force-push.
7. **Checks before committing** (section 3): the checker shows 0 findings for your folders (or only "Skipped" ones), and typecheck and lint pass for each app you touched.

---

## 2. Task list

**Progress (21-Oct-2026, measured with the checker in section 3):** 1,422 findings on `main` before the clean-up, 1,004 now, so 418 fixed.
Done and merged: API (most of S1), S3 and S11. The 4 findings left in S11 are parse errors for files outside the packages' tsconfig, skipped on purpose.

| Task | Folders (only these) | Approx. findings | Suggested agent | Branch |
|---|---|---|---|---|
| **S1** | `apps/api/src` (what's left: `tickets/`, `reminders/reminder-job.service.ts`, `invoices/invoice-template.ts`, `certificates/certificate-csv.ts`, `*.spec.ts` in `src`, `notifications/channels/whatsapp.channel.ts`, `notifications/providers/sms.provider.ts`, `main.ts`, `settings/`, `queue/`, `prisma/`, `consultants/availability.service.ts`, `config/env.ts`) | 52 left | Claude | `sonar-s1-api` |
| **S2a** ✅ | `apps/web/e2e`, `scripts/` | 37 | Jules (trial task) | `sonar-s2a-e2e` |
| **S2b** ✅ | `apps/api/test`: files whose names start with `a`–`d` (`admin-*`, `app.*`, `application*`, `bookings*`, `certificate*`, `cms*`, `consultant*`, `customer*`, `data-isolation*`) | ~75 | Jules | `sonar-s2b-api-tests` |
| **S2c** | `apps/api/test`: every other file (names from `e` to `z`, plus helpers such as `staff.ts`, `setup-env.js`) | ~120 | Jules | `sonar-s2c-api-tests` |
| **S3** ✅ | `apps/web/src/components`, `apps/web/src/lib`, and in `apps/web/src/app`: the root files (`page.tsx`, `layout.tsx`, `error.tsx`, `globals.css`, …), `login/`, `register/`, `forgot-password/`, `verify/`, `services/`, `blog/` | ~110 | Gemini Flash (finished by Claude) | `sonar-s3-web-public` |
| **S4** ✅ | `apps/web/src/app/dashboard` | 82 | Codex | `sonar-s4-web-dashboard` |
| **S5a** ✅ | `apps/web/src/app/consultants`, plus every other `apps/web/src/app/*` folder that S3, S4 and S5b don't list (today only `dev/`) | 31 | Codex | `sonar-s5a-web-consultants` |
| **S5b** ✅ | `apps/web/src/app/apply` | 42 | Codex | `sonar-s5b-web-apply` |
| **S6** ✅ | `apps/admin/src/app/(portal)/services` | 73 | Codex | `sonar-s6-admin-services` |
| **S7** ✅ | `apps/admin/src/app/(portal)/coupons`, `…/applications`, `…/certificates` | 91 | Codex | `sonar-s7-admin-apps` |
| **S8** | `apps/admin/src/app/(portal)/consultant`, `…/consultants`, `…/payments`, `…/customers`, `…/notifications` | 79 | Codex | `sonar-s8-admin-people` |
| **S9** | `apps/admin/src`: every other `(portal)` folder (settings, cms, documents, support, reports, privacy, reviews, audit, `[section]`, `layout.tsx`, `page.tsx`), plus `components/`, `lib/`, `app/two-factor`, `app/login`, `app/layout.tsx` | ~127 | Codex | `sonar-s9-admin-rest` |
| **S10a** ✅ | `apps/mobile`: everything except `src/screens` (`App.tsx`, `src/api`, `src/auth`, `src/navigation`, `src/components`, …) | ~45 | Codex | `sonar-s10a-mobile-core` |
| **S10b** ✅ | `apps/mobile/src/screens`: every file except `BuyFlowScreen.tsx` and `ApplicationDetailScreen.tsx` | 41 | Codex | `sonar-s10b-mobile-screens` |
| **S10c** ✅ | `apps/mobile/src/screens/BuyFlowScreen.tsx`, `apps/mobile/src/screens/ApplicationDetailScreen.tsx` | 30 | Codex | `sonar-s10c-mobile-flows` |
| **S11** ✅ | `packages/ui`, `packages/config`, `packages/rich-text` | ~75 | Devin (finished by Claude) | `sonar-s11-ui` |
| **S12a** | `packages/types` | 71 | Jules | `sonar-s12a-types` |
| **S12b** | `packages/api-client` | 41 | Jules | `sonar-s12b-api-client` |

Notes:
- **S2a/S2b/S2c (tests):** fix only unused imports, `replaceAll`, numeric separators, `structuredClone`, nested template literals and dead stores. **Leave** `await` in loops (tests run steps in order on purpose), "assertions in tests" (supertest's `.expect()` counts as an assertion) and hard-coded passwords. Those are seed/test credentials, so add `// NOSONAR: test credential` on those lines.
- **S11/S12a/S12b change shared packages.** After them, run typecheck for **every** app (web, admin, mobile, api), because they all import these packages.
- One agent per task at a time. When a task is merged, mark it ✅ in this table.

---

## 3. Set up and run the checker

The VS Code extension only checks open files. This checker runs the same kind of rules from the command line on
every file. It is installed in `/tmp`, **not** in the project.

**Once per machine/VM:**

```sh
mkdir -p /tmp/sonar-check && cd /tmp/sonar-check && npm init -y >/dev/null
npm i -s eslint@9.39.1 eslint-plugin-sonarjs@4.2.2 typescript-eslint@8.71.2 typescript@5.9.3 \
  eslint-plugin-unicorn@60 eslint-plugin-react@7.37.5 eslint-plugin-jsx-a11y@6.10.2
cp <repo>/docs/sonar/eslint.config.mjs <repo>/docs/sonar/check.mjs /tmp/sonar-check/
```

**Once per checkout** (type-aware rules need the built packages, and the API needs its Prisma client):

```sh
pnpm install --frozen-lockfile
pnpm --filter "./packages/*" build
DATABASE_URL=postgresql://placeholder@localhost:5432/placeholder pnpm --filter @biznexa/api exec prisma generate
```

**Run it from the repo root**, on your task's folders:

```sh
node /tmp/sonar-check/check.mjs apps/web/src/app/dashboard
```

It prints `path:line rule message`, then a count per rule. Lines with `// NOSONAR` are skipped.

**Typecheck and lint** for each app you touched:

```sh
pnpm --filter @biznexa/web typecheck && pnpm --filter @biznexa/web lint
pnpm --filter @biznexa/admin typecheck && pnpm --filter @biznexa/admin lint
pnpm --filter @biznexa/mobile typecheck && pnpm --filter @biznexa/mobile lint
pnpm --filter @biznexa/api exec tsc --noEmit
```

Agents that may run tests (Antigravity, Codex) also run that app's unit tests: `pnpm --filter <app> test`.
**Jules does not run tests.** It runs only the checker, typecheck and lint. Claude runs the tests when reviewing.

---

## 4. Fix catalogue

The rule id is SonarQube's (what VS Code shows). The checker's ESLint name is in brackets.

### React / JSX

- **S6759 "Mark the props of the component as read-only"** `[sonarjs/prefer-read-only-props]`. Wrap the props type in `Readonly<…>`:
  ```tsx
  export function Card({ title }: Readonly<{ title: string }>) {
  type Props = { … };  function X(props: Readonly<Props>)
  ```
- **S1874 "'FormEvent' is deprecated"** `[sonarjs/deprecation]`. Use `React.SubmitEvent<HTMLFormElement>` for `onSubmit` handlers and `React.ChangeEvent<…>` for `onChange`. Don't use `FormEvent`/`FormEventHandler`.
- **S6551 "`f.get('x') ?? ''` may use Object's default stringification"** `[no-base-to-string]`. For `FormData`, use a helper that keeps strings only:
  ```ts
  const v = data.get(name); return typeof v === 'string' ? v : '';
  ```
  The web app already has `formText(data, name)` in `apps/web/src/lib/form.ts`. If it isn't on your branch yet, create the same file. For `unknown` values: `typeof v === 'object' ? JSON.stringify(v) : String(v)`.
- **S6819 "Use `<output>` instead of the status role"** `[sonarjs/prefer-tag-over-role]`.
  - If the element holds only text or inline content, use `<output className="block …">` and drop `role="status"`.
  - If it holds headings, `div`s or lists (block content), keep the element, remove `role="status"` and add `aria-live="polite"`.
  - For "Use `<img alt>` instead of the presentation role" on a decorative list item, replace `role="presentation"` with `aria-hidden="true"`.
- **S9379 "Remove this autoFocus"** `[jsx-a11y/no-autofocus]`. Remove the `autoFocus` prop, add a ref and focus it once on mount:
  ```tsx
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  ```
  If the component took an `autoFocus` prop, keep the prop and focus only when it's true.
- **S6479 "Use a stable ID as key"** `[react/no-array-index-key]`. Use the item's `id`/`slug`/`code`. If items have no id, build a key from their content, and add `#n` when the same content repeats. See `keyedBlocks` in `apps/web/src/components/cms-page.tsx` (on `main`). Never use `Math.random()`.
- **S6772 "Ambiguous spacing after previous element"** `[react/jsx-child-element-spacing]`. Wrap the text in an element (`<span>`), or add `{' '}` where a space is wanted.
- **S6478 "Move this component definition out of the parent"** `[react/no-unstable-nested-components]`. Move the component to module level and pass what it needs as props. Table cell callbacks such as `cell: (row) => <…/>` are fine and can stay.
- **S6754 / S6767 / S6853 / S6848 / S1082**: follow the message. Name state as `[value, setValue]`, remove unused props, give labels `htmlFor`, use a `<button>` instead of a clickable `div`, add `onFocus`/`onBlur` next to `onMouseOver`/`onMouseOut`.
- **`@next/next/no-img-element`**: images from the CMS or uploads can come from any host, so `next/image` would need remote host config. Keep `<img>` and add the line above it:
  `{/* eslint-disable-next-line @next/next/no-img-element -- CMS images can come from any host */}`

### Conditionals and complexity

- **S3358 "Extract this nested ternary"** `[sonarjs/no-nested-conditional]`. Use one of these, in this order of preference:
  1. A lookup object: `const STAGE_DOT: Record<State, string> = { done: '…', current: '…', next: '…' }`.
  2. `let x = default; if (a) x = …; else if (b) x = …;` before the `return`.
  3. A small named function with early returns.
  
  In JSX, compute `let content: React.ReactNode` with `if/else` above the `return`, then render `{content}`. A single ternary (not nested) is fine.
- **S3776 "Cognitive Complexity from N to 15"** `[sonarjs/cognitive-complexity]`. Move self-contained parts into small named functions (module-level when they don't need `this`):
  - validation → `assertX()`
  - building a `where` object → `xWhere(query)`, with plain `if (q.x) where.x = …` lines
  - per-row work → `validateRow(row, ctx)`
  - a branch of a big `if` → its own private method
  
  Keep names and messages identical. Examples on `main`: `publicDirectoryWhere` (consultants.service.ts), `validateCsvRow` (certificates.service.ts), `checkCoupon` (order-summary.service.ts).

  In big React components, make only safe extractions (pure calculations, label/tone pickers, small render blocks). Don't restructure effects, state or the order of async calls. If a function is still over 15 after that, stop and list it under "Skipped" with file:line and its current complexity. A Skipped cognitive-complexity finding still meets the "checker shows no findings" condition: commit and push anyway.
- **S4624 "Do not use nested template literals"** `[sonarjs/no-nested-template-literals]`. Move the inner template into a `const` first:
  ```ts
  const ref = row.ref ? ` (${row.ref})` : ''; return `Paid${ref}`;
  ```
- **S6582 "Prefer optional chain"**: `if (!x || !x.y)` → `if (!x?.y)`, and `a && a.b === 1` → `a?.b === 1`. Watch the meaning: `!x || x.status !== 'A'` becomes `x?.status !== 'A'`.
- **S1121 "Extract the assignment"**: don't assign inside an expression. Write the assignment on its own line.
- **S1788 "Default parameter last"**: make it `param: T | undefined` and use `param ?? default` inside the function.

### Strings, numbers, arrays

- **S7781 "Prefer replaceAll"** `[unicorn/prefer-string-replace-all]`. Use `.replace(/x/g, …)` → `.replaceAll(/x/g, …)`. When the pattern is a plain literal, use a string: `.replaceAll('/', '-')`. A `.replace` without the `g` flag replaces only the first match, so leave it as it is.
- **S7780 "Use String.raw"**: write `String.raw\`\\.ts$\`` instead of `'\\\\.ts$'`, and `String.raw\`\\n\`` for a literal backslash-n.
- **S7749 "Invalid group length in numeric value"**: use groups of three, e.g. `3600_000` → `3_600_000`, `86400_000` → `86_400_000`.
- **S7778 "Merge these push() calls"**: build the array in one go (`[...a, ...b]`, or `push(a, b, c)`). For long CSV/text builders, use small helpers (`row(cells)`, `section(title, header, rows)`); see `apps/api/src/reports/report-csv.ts`.
- **S4043 "Move reverse/sort to a separate statement"**: `arr.reverse()` → `arr.toReversed()`, `arr.sort(f)` → `arr.toSorted(f)`. These need ES2023. They work in api, web, admin and `packages/ui`. **Not** in `packages/types` or `packages/rich-text` (ES2021): there, copy first (`[...arr].reverse()`) and use `arr[arr.length - 1]` instead of `.at(-1)`. Leave the `.at` finding as Skipped. For mobile, run typecheck after using them.
- **S7755 `.at(-1)`**, **S7758 `codePointAt`**, **S7765 `.includes(x)`** instead of `.some(v => v === x)`, **S7776 use a `Set` and `.has()`**, **S7784 `structuredClone`** (but see section 5), **S7744 remove `?? {}` in a spread** (`...x` is fine when `x` is undefined), **S7773 `Number.parseInt` / `Number.isNaN`**, **S6594 `regex.exec(s)`** instead of `s.match(regex)` (only without the `g` flag), **S6353 `\w`** instead of `[a-zA-Z0-9_]`.
- **S5843 / S8786 "Simplify this regular expression"**: remove overlapping parts that can backtrack. For example, put the dots between domain labels: `@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}`. For a long alternation list, build the regex from an array (`new RegExp(...)`) or use a `Set` lookup. Test the new regex on the examples in its spec file. When a simple `indexOf` scan works, use that (see `dropElements` in `apps/api/src/pdf/pdf-renderer.ts`).

### Async

- **S7503 "Async function has no await"** `[require-await]`. Remove `async`.
  - If the function must return a Promise (an interface or a caller awaits it), return `Promise.resolve(value)`.
  - If it throws, return `Promise.reject(err)` so callers still get a rejection.
  - In React event handlers that don't await anything, just drop `async`.
- **S9383 "Promises must be awaited"** `[no-floating-promises]`: on purpose fire-and-forget → `void promise`. Otherwise `await` it or add `.catch(...)`.
- **S9382 "Unexpected await inside a loop"** `[no-await-in-loop]`. Decide first whether the steps depend on each other:
  - **Independent** (different rows, no shared transaction, order doesn't matter): `await Promise.all(items.map(async (x) => …))`. If each item has its own `try/catch`, keep it inside the callback.
  - **Order matters** (writes in one transaction, sequential numbers, retries, rate-limited batches, events that must arrive in order):
    - API: use `inSequence(items, step)` from `apps/api/src/common/in-sequence.ts`, or `events.emitInOrder([...])` for events.
    - Elsewhere: keep the loop and add `// NOSONAR: <why order matters>` on the `await` line.
- **S878 "Comma operator"**: rewrite `(log(x), [])` as a block that logs, then returns.

---

## 5. When `// NOSONAR` is allowed

Only in these cases, always with a reason:
- `await` in a loop where order matters, and no shared helper fits (see above).
- An array index as `key` for rows that have no id **and are edited in place** (form repeater rows). A key built from the row's content would change on every keystroke and remount the row, which loses input focus: `// NOSONAR: rows have no id and are edited in place`.
- `Math.random()` used for retry jitter or other non-security purposes: `// NOSONAR: retry jitter, not security`.
- `JSON.parse(JSON.stringify(x))` used **to drop `undefined`** before saving JSON. `structuredClone` would keep it: `// NOSONAR: a JSON round trip drops undefined`.
- An `async` method with no `await` in a mock/test double that must reject like the real implementation.
- Test or seed credentials in test code.

Anything else that can't be fixed without changing behaviour: don't change it. List it under "Skipped" with the file:line and the reason.

---

## 6. What to report when done

Reply with:
1. The branch name and the commit hash.
2. Checker output for your folders. The last lines, with the count per rule, are enough.
3. Typecheck and lint results for every app you touched (and test results if your agent runs tests).
4. **Skipped**: file:line, rule, and why.
5. Anything you weren't sure about.

---

## 7. Copy-paste prompts

Replace `Sx` with the task id. The prompt is the same for every agent apart from the test line.

**Antigravity / Codex (may run unit tests):**

```
Read docs/SONAR_FIXES.md on branch main and do task Sx only.
- Create branch <branch from the table> from main.
- Set up the checker (section 3) and run it on the task's folders.
- Fix every finding using the fix catalogue (section 4). NOSONAR only as section 5 allows.
- Don't change behaviour and don't touch files outside the task's folders.
- Before committing: checker shows no findings left (except ones you list as Skipped), typecheck + lint pass
  for each app you touched, and that app's unit tests pass.
- One commit ("chore(sonar): Sx <area>"), push the branch, then report as section 6 says.
```

**Jules (no tests):**

```
Read docs/SONAR_FIXES.md on branch main and do task Sx only.
- Create branch <branch from the table> from main.
- Set up the checker (section 3) and run it on the task's folders.
- Fix every finding using the fix catalogue (section 4). NOSONAR only as section 5 allows.
- Don't change behaviour and don't touch files outside the task's folders.
- Do NOT run any tests, servers or Playwright. Run only the checker, typecheck and lint (section 3).
- Before committing, review your own diff: every name you use exists, no `any` or `as unknown as`, and no
  stray files.
- One commit ("chore(sonar): Sx <area>"), push the branch yourself. Do NOT open a pull request and don't wait
  for GitHub CI. Claude reviews the branch locally. Then report as section 6 says.
```

**Review (Claude):** fetch the branch and check that the diff only touches the task's folders. Run the checker, typecheck, lint and the app's tests. Check every NOSONAR against section 5. Then merge into `main`.
