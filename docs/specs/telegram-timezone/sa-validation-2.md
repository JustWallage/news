# SA Validation 2 — Per-user timezone for the Telegram daily feed

Spec: `docs/specs/telegram-timezone/index.md`
Worktree: `/Users/just/Documents/code-personal/news.worktrees/telegram-timezone`
Scope of this review: the expanded four-part spec (store timezone, capture at
link-code generation, echo in connect message, use in scheduled sends, plus the
preferences-screen selector).

## Summary

The spec is sound, right-sized, and fits the codebase. Every claimed file fact
checks out against real code. The chosen design reuses the existing patterns
(`safeParse → 400`, Drizzle `onConflictDoUpdate` upsert, the `dirty`-ref seed,
hand-rolled UI, nullable-column fallback) rather than inventing new machinery.
The two technical risks called out for special attention — the `time.ts`
refactor and `Intl.supportedValuesOf` typing — are both fine. The refactor's
only non-test caller is `scheduled.ts`, and `supportedValuesOf` is typed under
the project's `lib: ["ES2023"]` (verified by compiling a probe).

The only gap worth flagging is test bookkeeping: the signature change to
`mintLinkCode` and the widened status schema break several _existing_ tests that
the spec's Test section under-specifies. These are mechanical and in-scope, but
the spec should name them so they aren't missed (a green `pnpm check` is a
verification gate, so they cannot be silently skipped — but calling them out
avoids a surprise mid-implementation). Not blocking.

## Findings per axis

### Soundness — solves the problem, right shape

- Browser `Intl.DateTimeFormat().resolvedOptions().timeZone` is correctly
  identified as the only viable source; Cloudflare Access exposes only an email
  (confirmed: routes read `c.get("userEmail")`, no other identity claim is
  available). Correct.
- The slot-matching swap is the right shape: `dueSlot(row, minute)` already
  takes a minute-of-day, so parameterizing the minute by `row.timezone ??
"Europe/Amsterdam"` is a minimal, surgical change at the one call site
  (`worker/lib/scheduled.ts:67`). No change to `dueSlot` or slot storage needed.
- Nullable column with Amsterdam fallback preserves existing owner behaviour and
  pre-existing rows. Sound.
- `saveTimezone` upserting before a chat is linked is correct — the `telegram`
  row is keyed by `userEmail` (primary key), and `loadTelegramStatus` already
  tolerates a row with `chatId == null` (returns `linked: false`). A timezone-only
  row is valid.

### Right-sizing

- Native `<select>` over a radix/shadcn Select dependency is the correct call:
  `src/components/ui/` confirmed to hold only button/card/label/textarea, and the
  repo's stated convention is hand-rolled components. No over-engineering.
- One shared `telegramTimezoneSchema` for both `POST /link-code` and
  `PUT /timezone` (identical `{ timezone }` shape) is appropriately DRY without
  being clever.
- Extracting `parseJsonBody` to `worker/lib/http.ts` is right-sized: the function
  body is duplicated verbatim once `telegram.ts` adds body parsing, and the repo
  runs jscpd in `pnpm check`. Pre-empting the duplication finding is justified,
  not gold-plating.
- Saving the timezone on `<select>` change (rather than adding a Save button) is
  the simplest correct UX and matches "persisted, editable."

### Codebase fit

- `safeParse(await parseJsonBody(...)) → 400` is the exact existing pattern in
  `worker/routes/preferences.ts:33-39`. Reused, not reinvented.
- Upsert via `.onConflictDoUpdate({ target: telegram.userEmail, set: {...} })`
  mirrors `mintLinkCode` (`worker/lib/telegram-bot.ts:129-135`). Consistent.

  Note: the spec's prose for `saveTimezone` writes the target as
  `target: userEmail` — the real Drizzle API (and the existing call site) uses
  `target: telegram.userEmail` (the column, not the value). Treat the spec
  snippet as shorthand; the implementation must use `telegram.userEmail`.

- The frontend `dirty`-ref seed pattern the spec references is real
  (`PreferencesPage.tsx:164-170`); applying the same guard to the timezone state
  is the correct fit. `jsonInit("PUT", { timezone })` and `apiFetch`/`mutate` are
  all existing primitives (`src/lib/api.ts`, `useCachedFetch`).
- Migration: `pnpm migrate:gen` (= `drizzle-kit generate`) exists; existing
  migrations are `0000..0002`, so `0003_*.sql` is the correct next number. The
  "never hand-write" instruction matches the repo rule.
- `telegramStatusSchema` widening with `timezone: z.string().nullable()` flows
  through `loadTelegramStatus` (which returns the object) and the `GET /` route
  that `.parse()`s it. The frontend reads `data.timezone`. Contract is coherent
  end to end.

### Risk / gaps

- **`time.ts` refactor (the flagged item).** `amsterdamMinuteOfDay` has exactly
  one non-test caller: `worker/lib/scheduled.ts` (import line 11, use line 67).
  Verified by grep across the repo. Removing it and adding `minuteOfDayInTz` is
  safe; `amsterdamHour` (used by `runScheduledDigest`, the out-of-scope web
  digest path) and `amsterdamDate` stay. knip would indeed flag the symbol if
  left unused, so removal is correct, not optional.

  `minuteOfDayInTz` is a faithful generalization of `amsterdamMinuteOfDay` (same
  `formatToParts` + `get` logic, `TZ` becomes a parameter). No behavioural change
  for the Amsterdam fallback.

- **Test impact of the refactor (under-specified, non-blocking).**
  `worker/lib/scheduled.test.ts` _imports and calls_ `amsterdamMinuteOfDay`
  (lines 11, 93) to compute the slot it inserts — it is not merely asserting on
  it. When the symbol is removed this file stops compiling. The spec's
  `scheduled.test.ts` bullet describes new timezone cases but does not state that
  the existing `const minute = amsterdamMinuteOfDay(now)` must be migrated to
  `minuteOfDayInTz(now, "Europe/Amsterdam")` (or the fixture given a timezone).
  Mechanical, but should be named.

  Likewise `worker/lib/time.test.ts` has a dedicated
  `describe("amsterdamMinuteOfDay …")` block (lines 25-34) that must be replaced
  (the spec's time-test bullet covers this — good).

- **`Intl.supportedValuesOf` typing (the flagged item).** Verified typed:
  `node_modules/typescript/lib/lib.es2022.intl.d.ts:142` declares
  `supportedValuesOf(key: ... | "timeZone" | ...): string[]`. `lib.es2023` pulls
  in `lib.es2022` which references `lib.es2022.intl`, so `lib: ["ES2023"]`
  resolves it. Confirmed by compiling a probe (`Intl.supportedValuesOf("timeZone")`)
  under `tsconfig.app.json` — `tsc` exited 0. The selector only runs in the
  browser bundle (app config), so worker-side `lib` is irrelevant here. No
  guard/fallback needed.

- **Existing route tests break on the new contract (under-specified,
  non-blocking).**
  - `worker/routes/api.test.ts:94` asserts the status with
    `toEqual({ linked, chatLabel, slots })` — an exact-match. The widened schema
    adds `timezone: null`, so this must gain `timezone: null`.
  - `worker/routes/api.test.ts:101` and `:115` POST `json("POST", {})` to
    `/link-code`. With the new `telegramTimezoneSchema` body parse, an empty body
    `{}` fails the required `timezone` and returns 400 — these two existing tests
    (the mint test and the webhook-linking test) will fail unless updated to send
    `{ timezone: "…" }`. The spec's route-test bullet says to add a timezone case
    but does not call out that the _pre-existing_ empty-body posts must also be
    fixed.

- **`mintLinkCode` signature change ripples to 8 call sites.** New signature
  `mintLinkCode(db, userEmail, timezone, now)`. Callers: `worker/routes/telegram.ts:24`
  and `worker/lib/telegram-bot.test.ts` lines 83, 106, 120, 130, 143, 153, 173.
  The spec's unit-test bullet says "pass a timezone to every `mintLinkCode`,"
  which covers the test file; the route caller is covered by the routes section.
  Adequately specified — listed here for completeness.

  Parameter ordering (`timezone` before `now`) is a reasonable choice; both are
  required, so order is cosmetic. No concern.

- **`handleStart` timezone line vs. the `toContain("Linked")` assertion.** The
  spec keeps "Linked!" in the first line and only appends the timezone line when
  non-null, so `telegram-bot.test.ts:86` (`toContain("Linked")`) still passes.
  Correct. The new assertion (reply contains the timezone string) requires the
  minted row to carry a timezone — which the updated `mintLinkCode(db, USER,
"America/New_York", …)` provides. Consistent.

- **No DST gap/overlap handling** — explicitly out of scope, and acceptable for
  a single-owner schedule. The `*/5` heartbeat means a spring-forward-skipped
  slot is simply missed that day; documented as out of scope. Fine.

### Open questions

None material. One minor confirmation:

- The spec says "Show the selector whether or not the chat is linked." The
  current `TelegramSection` renders the connect block unconditionally and gates
  only the "Send test"/status line on `linked`, so an always-visible selector
  fits the existing layout without restructuring. No fork.

## Spec-change list (all non-blocking; recommend folding in for precision)

1. **`saveTimezone` upsert target.** State `target: telegram.userEmail` (the
   column reference), not `target: userEmail`, to match Drizzle's API and the
   existing `mintLinkCode` upsert.
2. **Name the existing-test edits** in the Test section so they aren't missed:
   - `worker/lib/scheduled.test.ts`: migrate the `amsterdamMinuteOfDay(now)`
     helper (lines 11, 93) to `minuteOfDayInTz(now, "Europe/Amsterdam")`.
   - `worker/routes/api.test.ts:94`: add `timezone: null` to the `toEqual` status
     assertion.
   - `worker/routes/api.test.ts:101` and `:115`: change the existing
     `json("POST", {})` link-code posts to include a valid `{ timezone }` (else
     they 400 under the new body schema).

These are bookkeeping refinements, not design changes. `pnpm check` (the
mandatory gate) would catch all of them, so they cannot ship broken; naming them
just removes mid-implementation surprise.

## Verdict

The design is sound, simplest-correct, and fits the codebase; the two flagged
technical risks are verified safe; the only gaps are mechanical test updates that
are in-scope and gated by `pnpm check`. No blocking issue.

VERDICT: APPROVED
