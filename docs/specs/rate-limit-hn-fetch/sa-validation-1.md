# SA Validation — Rate-limit HN front-page fetching

Spec: `docs/specs/rate-limit-hn-fetch/index.md`
Reviewed against: `worker/lib/digest.ts`, `db/schema.ts`, `worker/lib/hn.ts`,
`worker/lib/digest.test.ts`, `worker/routes/digest.ts`, `worker/lib/scheduled.ts`.

## Summary

The spec adds a 5-minute global rate limit on the HN front-page fetch inside
`runDigest`, swapping the candidate source from `deps.hn.frontPage()` to the
last DB snapshot (rows whose `fetchedAt` equals the global max) when within the
window. Per-user evaluation, the empty-prefs fallback, and the feed rebuild are
explicitly untouched. The design is sound, correctly scoped, and fits the
codebase: it intervenes at the one shared pipeline so Refresh, cron, and e2e all
inherit the behavior through a single code path, with no API/schema/SPA changes.

The approach is right-sized — a constant, one extra read, and a branch — with no
new config surface or abstractions invented. The only correctness claims that
warranted scrutiny (timestamp precision and equality-based snapshot selection)
check out against the real schema. One factual error exists in the spec's test
narrative (a feed assertion), and a couple of small clarifications are worth
folding in, but none are blocking.

## Findings by axis

### Soundness — solves the problem, right shape

- Verified `runDigest` (worker/lib/digest.ts:84) unconditionally calls
  `deps.hn.frontPage()` then upserts the cache, exactly as the spec's Background
  states. The proposed prologue replacement is the correct intervention point.
- "Globally last HN fetch = max `stories.fetchedAt`" holds: every row in one
  invocation is stamped with the same `now` (lines 105/106, 115), and
  reappearing stories always get `fetchedAt = excluded.fetched_at` on conflict,
  so the current front page shares one `fetchedAt`. Stories that fell off retain
  an older `fetchedAt`. Equality on the max therefore isolates exactly the last
  snapshot. Correct.
- The mapping back to `StoryInput` (`time = Math.floor(row.time.getTime()/1000)`)
  round-trips exactly: `time` is written as `new Date(s.time * 1000)` and the
  column is integer `mode:"timestamp"`, i.e. epoch seconds, so no precision is
  lost on the round trip.
- Routes pass `new Date()` as `now` (worker/routes/digest.ts:22), so the window
  is real wall-clock-driven in prod, and tests can inject `now` to exercise both
  branches — matching the test plan.

### Right-sizing

- Minimal and correct: one module constant, one `select … order by desc limit 1`,
  one branch. No new config surface, no schema change, no new abstraction — all
  consistent with the Out-of-scope section and the codebase's "don't export for
  later" ethos. No over-engineering.
- No under-engineering detected. The rate limit deliberately lives below the
  route rather than as HTTP middleware, which is the correct call given cron and
  e2e must share it; the spec justifies this explicitly.

### Codebase fit

- Reuses existing Drizzle patterns (`select().from(stories).orderBy(desc(...))`).
  `desc` is not yet imported in digest.ts (current imports: `and, eq, sql`); the
  implementer must add it to the `drizzle-orm` import. Minor, mechanical.
- Honors the hard rules: timestamp inference yields a `Date` with no `as` cast;
  no new cross-boundary types (StoryInput already lives in digest.ts and is the
  shared shape). No invariant broken — the global cache semantics and the
  per-user `reusable`/`toEvaluate` split (lines 138-186) are preserved because
  only `candidates` resolution moves ahead of them.
- The `chunk`/`STORY_CHUNK` upsert is simply skipped on the rate-limited path;
  nothing downstream depends on the upsert having run (the feed rebuild reads
  `evaluated`, derived from `candidates`).

### Risk / gaps / edge cases

- Empty cache (`lastFetch === null`) → fetch. Covered and correct; matches
  first-run and wiped-DB behavior.
- D1 100-param cap: the rate-limited candidate read is a single-condition
  `where fetchedAt = ?` (one bound param), so it does not approach the cap. The
  existing version-skip read is likewise unchanged. No regression.
- Concurrency: two near-simultaneous first runs on an empty cache could both
  fetch HN (no lock). This is pre-existing behavior, out of scope, and benign
  (idempotent upserts). Worth a one-line acknowledgment but not a blocker.
- Cron-rate-limited edge (cron within 5 min of a manual refresh skips the fetch)
  is explicitly accepted in Decisions and is genuinely negligible for a
  once-daily, single-user cron.

## Open questions (non-blocking)

1. **Stale-score acceptance.** Within the window, a second user sees the frozen
   snapshot's scores/comments, not live HN values. This is the stated intent
   ("within 5 min, everything is the same"). Recommend: confirm explicitly in the
   spec that serving slightly stale score/comment counts for up to 5 minutes is
   intended (it reads as intended; just make it loud).

## Spec changes requested (corrections, not redesign)

1. **Test narrative error (spec line 141).** For "evaluates only newly appeared
   stories at the same version," the spec says the feed becomes `[1, 2, 3]`. The
   existing test asserts `[1, 3]` (digest.test.ts:349) because story 2
   ("Bitcoin moons") is not relevant under the `"rust"` keyword filter and never
   enters the feed. The `seen === [1]` part is right; fix the feed value to
   `[1, 3]` so the implementer doesn't "correct" a passing test to a wrong value.

2. **Add `desc` import note.** Step 2 of Implementation should note that `desc`
   must be added to the existing `drizzle-orm` import in digest.ts (currently
   only `and, eq, sql`). Trivial but avoids a missed import.

These are documentation/accuracy fixes to the spec text; they do not change the
design, which is approved as-is. They can be folded in during implementation.

VERDICT: APPROVED
