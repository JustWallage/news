# SA Validation 1 — Telegram timezone capture and echo

Spec: `docs/specs/telegram-timezone/index.md`
Reviewer: solutions architect (design gate, no code)

## Summary

The spec captures the browser IANA timezone at link-code mint time, stores it on
the `telegram` row, and echoes it in the `/start <code>` success reply. The design
is sound, minimal, and matches existing codebase patterns (Zod contract in
`shared/`, `safeParse` + `parseJsonBody` → 400 as in `preferences.ts`, Drizzle
upsert in `mintLinkCode`). I verified every file and signature the spec cites
against the worktree; they are all accurate. The scope is correctly fenced off
from scheduling, which still runs on `amsterdamMinuteOfDay`. One real issue needs
attention before implementation (a behavior change the spec under-states), plus
two minor notes. None are architectural; the shape is right.

## Findings by axis

### Soundness — solves the problem, right shape

- The two requested behaviors (capture-on-generate, echo-on-connect) map directly
  to `mintLinkCode` and `handleStart` in `worker/lib/telegram-bot.ts:122` and
  `:139`. Both signatures match the spec's "current behaviour" section exactly.
- Browser `Intl...timeZone` as the only source is correct: auth is Cloudflare
  Access (email only), confirmed by `c.get("userEmail")` usage throughout the
  routes. There is no profile/claim to pull a zone from.
- The `Intl.DateTimeFormat` try/catch refine is valid on both runtimes (workerd
  and browser both ship `Intl`). Sound.

### Right-sizing

- Nullable text column, no editor UI, no scheduler wiring — this is the minimal
  correct slice. The spec explicitly defers scheduling and the prefs-UI editor.
  No over-engineering.
- No under-engineering either: validation, migration, contract, and tests are all
  accounted for.
- The spec leaves "share or duplicate `parseJsonBody`" as implementer's choice.
  `parseJsonBody` currently lives privately in `worker/routes/preferences.ts:11`.
  Given the `jscpd` gate in `pnpm check`, duplicating a second identical copy in
  `telegram.ts` is a real (if small) clone-detection risk. Recommend extracting
  it to a tiny shared helper rather than duplicating — but this is implementer
  discretion, not a blocker.

### Codebase fit

- Contract placement in `shared/api.ts` next to `telegramLinkCodeSchema` is
  correct and matches the "schemas = contracts" rule in CLAUDE.md.
- The 400 pattern (`safeParse(await parseJsonBody(...))` → `{ error: "Invalid
request body" }`) is copied verbatim from `preferences.ts:33-39`. Good fit.
- Migration via `pnpm migrate:gen` (= `drizzle-kit generate`) is the right path;
  existing migrations are `0000`–`0002` so `0003_*.sql` is the correct next name.
  Hand-writing is correctly forbidden.
- The `telegram` table leading comment (`db/schema.ts:55`) does need updating per
  the CLAUDE.md "docs standard" rule; the spec calls this out. Good.

### Risk / gaps

- **BLOCKING-ish behavior change the spec under-states.** Today
  `POST /link-code` ignores the body entirely (`worker/routes/telegram.ts:22`).
  After this change, a request with a missing/invalid `timezone` returns 400.
  That is the intended new contract, but it makes the endpoint strictly stricter,
  and there are existing callers/tests that send `{}`:
  - `worker/routes/api.test.ts:101, :115, :172` all POST `json("POST", {})` to
    `link-code`. These will start returning 400 and the tests will break. The spec
    says "Update each `link-code` POST to send `{ timezone: ... }`" — so this is
    covered, but the implementer must update **all three** call sites (the spec's
    test section reads as if it is illustrative; it must be exhaustive). Line
    `:101` in particular asserts the minted code shape and stored `linkCode`, so
    it must keep working.
  - `src/pages/PreferencesPage.tsx:30` currently sends `jsonInit("POST", {})`.
    The spec's step 6 changes this. Must land in the same change or the live
    connect flow (and the e2e at `e2e/telegram.spec.ts:10`) breaks with a 400.
    This is internally consistent in the spec, but the failure mode (every existing
    `{}` caller now 400s) deserves to be stated as such so nothing is missed. Not a
    design flaw — just make sure the frontend + all three route tests change
    atomically with the route.
- Re-mint overwrites timezone with latest browser value: correct and matches the
  existing "latest generate wins" semantics for `linkCode`.
- Null-timezone defensive omission in the reply keeps the existing
  `expect(reply).toContain("Linked")` assertion (`telegram-bot.test.ts:86`)
  intact. Verified that assertion exists and only checks "Linked".

### Open questions

None material. The design has no unresolved forks; the `parseJsonBody`
share-vs-duplicate choice is the only latitude and either path passes the gate
(share is safer re: jscpd).

## Spec-change list (recommended, non-blocking)

1. In the Tests section, make explicit that **all three** `link-code` POSTs in
   `worker/routes/api.test.ts` (lines 101, 115, 172) must be updated to send
   `{ timezone: "America/New_York" }`, not just "each" generically — they all
   currently send `{}` and will 400 otherwise.
2. Add a one-line risk note under "Risk/gaps" stating that `link-code` becomes
   strictly stricter (missing body → 400), so the frontend change (step 6) and
   the route-test changes must land in the same commit as the route change to
   avoid breaking the live connect flow and e2e.
3. Recommend extracting `parseJsonBody` to a shared helper (e.g. a small
   `worker/lib` util) instead of duplicating, to avoid a `jscpd` clone finding in
   `pnpm check`. (Implementer discretion; flag only.)

These are clarifications and a safety note, not design changes. The architecture,
contract placement, validation approach, migration path, and scope are all
correct.

VERDICT: APPROVED
