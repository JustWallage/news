# SA Validation — Redesign the preferences page

Spec: `docs/specs/cleanup-preferences-page/index.md`
Reviewed against: `src/pages/PreferencesPage.tsx`, `src/components/ui/card.tsx`,
`shared/api.ts`, `e2e/telegram.spec.ts`, `e2e/preferences.spec.ts`, `wrangler.jsonc`.

## Summary

A pure front-end redesign of `PreferencesPage.tsx`: regroup the flat column into
`Card` sections, reorder the Telegram connect flow (bot link first, copy-command
fallback below), rename labels, move the timezone into a linked-only "Daily
summaries" card, and make the empty slot state unambiguous (muted input + "Not
set"). No API/schema/worker/DB changes.

The spec is sound, right-sized, and fits the codebase. It reuses the existing
`Card` family and primitives, preserves every data flow and every e2e-relevant
selector, and correctly scopes itself to layout/copy. One test claim needs to be
resolved before implementation (the `code.url` value in the e2e env), but the
spec already anticipated the fork and gave the correct fallback, so it is not
blocking — it just needs to be settled to avoid a broken test. There are also two
minor selector/correctness notes worth pinning down so the implementer does not
discover them mid-flight.

## Findings by axis

### Soundness — solves the problem, right shape

Sound. Every user complaint maps to a concrete change:

- "sections split better / not clear what belongs together" → `Card` grouping.
- "unclear when a daily summary time is set or cleared" → muted input + explicit
  "Not set" text. This is stronger than greying alone and directly addresses the
  native `--:--` ambiguity called out in lines 30-32.
- "move copy command under open bot button / make clear it links the account /
  better name" → reorder so the bot link is the prominent primary action, rename
  "Open the bot" → "Link my account", copy block demoted to fallback below.

The shape is a straight component re-layout. No state machine, hook, or data-flow
change is introduced or needed — correct, since the request is purely presentational.

### Right-sizing — simplest correct

Right-sized. No new primitives, no new colors, no new dependencies (explicitly out
of scope). It reuses `Card`/`CardHeader`/`CardContent`/`CardFooter`/`buttonVariants`/
`cn` that already exist. The "Not set" + muted-input affordance is the minimal
addition that satisfies the certainty the user asked for. No over-engineering
(no abstraction of slots into a sub-component is mandated, though the implementer
may), no under-engineering (the set/cleared distinction is fully specified incl.
the `code.url === null` fallback).

The decision to move timezone into the linked-only card (lines 117-121) is a
reasonable judgment call and well-justified (timezone schedules summaries; an
unlinked user has nothing to schedule). `connect()` still mints the code with the
browser-detected timezone exactly as today (line 136, `jsonInit("POST", { timezone })`),
so the behavior is preserved — the only change is visibility. Confirmed against code.

### Codebase fit — reuse, invariants

Fits well. Verified against the real component:

- The `tzDirty` / `slotsDirty` / `dirty` seeding guards (lines 68-81, 372-376) are
  preserved by the spec (lines 54, 108, 120). These are the invariant CLAUDE.md
  calls out ("upsert behavior", background-revalidate guard) — the spec explicitly
  keeps them.
- `SLOT_LABELS = ["First","Second","Third"]`, `step={300}`, aria-labels
  `First/Second/Third daily summary time` and `Clear <name>` are all preserved
  (spec lines 104-107) and match the code exactly (lines 25, 202, 207, 226).
- `who` computation, `ConfirmDialog` copy, `Send test message` / `Save times`
  statuses, `Copy`/`Copied` logic — all preserved per spec, all match code.
- No `as` casts introduced; types stay sourced from `@shared/api`. No new exports
  (knip-safe).

`Card`/`CardFooter` exist and behave as the spec assumes (footer auto-styled with
`border-t bg-muted/50`); using `CardFooter` for the Save/status row is idiomatic.

### Risk / gaps / edge cases

1. **`code.url` is null in the e2e env (material — must resolve).** The spec's
   test note (line 145) asks to "confirm; if null, assert the manual block instead."
   I confirmed: `wrangler.jsonc` sets `"TELEGRAM_BOT_USERNAME": ""` for both the
   committed default and the `e2e` env (lines 26, 44), and `worker/CLAUDE.md` states
   empty username → link-code `url` is null. Therefore in e2e the "Link my account"
   anchor will **not** render. The test at `e2e/telegram.spec.ts:37` must NOT assert
   a "Link my account" affordance — it must assert the manual `/start <code>` block
   (which it already does). So the spec's fallback branch is the one that applies.
   This is anticipated by the spec, not a defect, but the implementer must take the
   "if null" path or the test will fail. Recommend the spec state this outright
   rather than leaving it as "confirm".

2. **Timezone test must link first (already in spec, but verify the `Timezone`
   label still resolves).** Current test `the timezone selector persists the chosen
zone` (lines 57-71) runs unlinked. Spec line 148-150 correctly says to `linkChat`
   first. Note `getByLabel("Timezone")` relies on `<Label htmlFor="timezone">` +
   `<select id="timezone">` — the spec preserves both (line 95), so the selector
   resolves once rendered inside the linked card. No issue, just confirming the
   contract holds after the move.

3. **"Not set" text vs. existing visible copy — selector collision risk (minor).**
   The new test asserts `"Not set"` is visible (line 154). Ensure the string used in
   the component is exactly `"Not set"` and not embedded in a longer sentence, so the
   `getByText` is unambiguous across three slots. With three empty slots, three
   "Not set" nodes exist — the test should use a count or scope to a slot row, or fill
   one slot and assert exactly two remain. Worth a one-line note in the test plan.

4. **`Connected.` hidden-assertion (minor).** `telegram.spec.ts:42` asserts
   `getByText(/Connected\./)` is hidden when unlinked. The spec keeps the `who`
   line only in the linked branch, so this holds. No change needed; just preserve
   the literal "Connected" / "Connected as" copy.

No failure modes in data flow: all network calls (`connect`, `saveSlots`,
`changeTimezone`, `sendTest`, `disconnect`, `copy`) are untouched per spec.

## Open questions

1. **Does the e2e env produce a non-null `code.url`?** Recommended answer: **No**
   — `TELEGRAM_BOT_USERNAME` is `""` in the e2e env, so `code.url` is null and the
   "Link my account" anchor does not render in e2e. The e2e test must assert the
   manual command block (as it does today), not the bot link. Update the spec's
   line 145 from "confirm" to this resolved statement.

2. **Regenerate affordance placement when linked.** Today the same `connect()`
   button is reused both before and after linking (it doubles as "Regenerate", code
   lines 305-311). The spec's redesign scopes "Generate connect link" + reveal to the
   **unlinked** state (Card 2 "When NOT linked"). Confirm the implementer drops the
   now-orphaned "Regenerate" path for the linked state (a linked user has no use for
   a connect code). Recommended answer: yes — once linked, no connect-code UI is
   shown; the linked branch only offers Send test / Disconnect. The spec already
   implies this (lines 81-87 list only those two actions) but does not say "remove
   the connect button when linked" explicitly. Worth stating.

## Spec-change list (non-blocking, recommended before implementation)

- Line 145: replace "the `code.url` is non-null in the e2e env — confirm; if null,
  assert the manual block instead" with the resolved fact: `code.url` is **null** in
  e2e (`TELEGRAM_BOT_USERNAME=""`), so assert the manual `/start <code>` block; do
  not assert a "Link my account" affordance in e2e.
- Tests section: for the new "Not set" assertion, specify scoping (fill one slot,
  assert that slot loses "Not set" while others keep it) to avoid the three-node
  ambiguity.
- Card 2 / linked state: state explicitly that the connect-code generation UI is
  not rendered when already linked (the "Regenerate" path is removed, not relocated).

None of these block design approval — they are clarifications to prevent a broken
e2e run and an ambiguous selector. The design itself is sound, minimal, and fits.

VERDICT: APPROVED
