# Review 1 — Rate-limit HN front-page fetching

## Summary

The implementation matches the spec precisely. `runDigest` now resolves its
candidate set up front: it reads the latest `stories.fetchedAt`, and within a
5-minute window reuses the cached snapshot (rows sharing that timestamp) without
calling `deps.hn.frontPage()` or upserting `stories`; otherwise it fetches and
upserts as before. The per-user evaluation, empty-prefs fallback, and feed
rebuild are untouched and operate on `candidates` exactly as the spec requires.
`pnpm check` is green (37 unit tests pass), and the doc surfaces (db/CLAUDE.md,
worker/CLAUDE.md) were updated in the same commit. Scope is limited to
`worker/lib/digest.ts` + its test file plus docs — no API/route/SPA/schema
changes, as mandated.

## Findings per axis

### Simplicity — clean

The change is the simplest correct shape: a single `if/else` on
`lastFetch !== null && now - lastFetch < RATE_LIMIT_MS`, the existing upsert
loop moved verbatim into the `else` branch, and one small `toStoryInput`
helper. No abstraction was introduced that the spec did not call for.

### Spec implementation — clean

Every requirement is present and faithful:

- `RATE_LIMIT_MS = 5 * 60 * 1000` named constant
  (worker/lib/digest.ts:44).
- Latest-fetch query is exactly the prescribed
  `select({ fetchedAt }).orderBy(desc(...)).limit(1)` with
  `lastFetch = latest?.fetchedAt ?? null` (worker/lib/digest.ts:109-114); `desc`
  added to the `drizzle-orm` import (line 1) — no raw SQL, no `as` cast.
- Comparison `now.getTime() - lastFetch.getTime() < RATE_LIMIT_MS`
  (worker/lib/digest.ts:118-119).
- Within-window branch selects rows where `fetchedAt` equals `lastFetch`, maps
  to `StoryInput`, skips the upsert, and logs the one-line `[digest]
rate-limited` note with the candidate count (worker/lib/digest.ts:121-129).
- `time` mapped as `Math.floor(row.time.getTime() / 1000)` epoch seconds
  (worker/lib/digest.ts:62), matching `StoryInput.time`.
- Empty cache (`lastFetch === null`) always fetches.
- Nothing invented: no config surface, no schema change, evaluation/feed logic
  unchanged.

The equality-match assumption is sound: `fetchedAt` is an integer
(second-precision) timestamp column (db/schema.ts:19) stamped with the single
`now` per run, so `eq(stories.fetchedAt, lastFetch)` selects precisely the last
snapshot.

### No shortcuts — clean

No stubs, TODOs, swallowed errors, or hacks. The HN-fetch path and upsert were
relocated, not weakened; error propagation is unchanged.

### Code quality — clean

Follows existing conventions (Drizzle inference via `StoryRow`, `z`-free plain
shape `StoryInput`, chunked upsert untouched). `StoryRow` is a real schema
export (db/schema.ts:54), so the helper is correctly typed without casts.
Comments are short and explain the non-obvious invariant (one fetch → one shared
`fetchedAt`), consistent with the repo's comment rule.

### Tests — clean

All five spec test scenarios are covered in worker/lib/digest.test.ts:

- "reuses the cached snapshot without re-fetching HN within the window" — second
  user at +1 min, `hnB.fetches() === 0`, feed built from cache, and
  `filterB.seen === [FRONT.length]` (spec tests 1 + 2).
- "sends nothing to the AI for a within-window re-run at the same version" —
  same user at +2 min, `hn.fetches() === 0`, `again.seen === [0]`, feed rebuilt
  from reused verdicts (spec test 5).
- "fetches HN again once the rate-limit window has elapsed" — +6 min,
  `later.fetches() === 1` (spec test 3).
- Empty-cache-fetches behavior remains asserted by "fetches the front page once
  and caches every candidate" (spec test 4).

The two existing tests the spec flagged were updated to advance `now` past the
window on the second run ("refreshes cached story content on a later run" and
"evaluates only newly appeared stories at the same version",
worker/lib/digest.test.ts). The remaining back-to-back `new Date()` tests
("isolates feeds per user", "skips stories already evaluated...",
"re-evaluates every front-page story...") correctly stay unchanged because the
frozen cache equals the fake HN front page.

## `pnpm check`

Passed (EXIT=0). 37/37 unit tests green. The `env.e2e`/`ai` wrangler warnings
and the knip "redundant entry pattern" hints are pre-existing and non-fatal
(the gate returns 0).

## Action list

None required.

VERDICT: APPROVED
