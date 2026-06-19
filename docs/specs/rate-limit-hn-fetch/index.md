# Rate-limit HN front-page fetching

## Request (verbatim)

A rate limiting feature that prevents spamming of the refresh button. When the
globally last fetched story is < 5min ago, then don't refetch HN, but simply
query from the db. Check for the current user whether all of the current posts
have been evaluated yet and only evaluate the ones that weren't yet (or were
using an older preference version). This is only the case if another user has
triggered the HN fetch within the past 5 min and the current user hasn't
evaluated all the current posts yet. Basically I want to rate limit the HN
fetching, so within 5 min, everything is the same, but it fetches from the db
instead HN. Use the latest fetchedAt timestamp from the stories table to
determine the globally last HN fetch.

## Background

`runDigest` ([worker/lib/digest.ts](../../../worker/lib/digest.ts)) is the single
pipeline behind the homepage Refresh button (`POST /api/digest/run`), the 06:20
cron ([worker/lib/scheduled.ts](../../../worker/lib/scheduled.ts)), and e2e. Today
it **always** calls `deps.hn.frontPage()` and then upserts the global `stories`
content cache, regardless of how recently another run already pulled the front
page.

The `stories` table is a global, cross-user content cache. Every story written
in a single `runDigest` invocation is stamped with the same `fetchedAt` (the one
`now` passed in), so the most recent front-page snapshot is exactly the set of
rows sharing the maximum `fetchedAt`.

The per-user evaluation step already does the right thing: it reuses curation
rows stamped with the current `prefVersion` and only sends the AI the candidates
not yet judged at that version (see the `reusable`/`toEvaluate` split). This spec
does **not** change that logic — it only changes where the _candidate set_ comes
from.

## Requirement

Rate-limit the HN fetch. When the globally last HN fetch (the latest
`stories.fetchedAt`) is **less than 5 minutes** before `now`:

- Do **not** call `deps.hn.frontPage()` and do **not** upsert the `stories`
  cache.
- Use the last front-page snapshot already in the DB as the candidate set: all
  `stories` rows whose `fetchedAt` equals that latest timestamp.
- Evaluate the current user against those candidates exactly as today — reuse
  verdicts already stamped at the current `prefVersion`, send only the
  not-yet-judged (or older-version) candidates to the AI.

Otherwise (5+ minutes elapsed, or the cache is empty), fetch from HN and upsert
the cache as today.

Net effect: within a 5-minute window the front-page snapshot is frozen; a second
user (or a second click) reuses the cached stories and only pays AI cost for the
candidates that user has not yet evaluated. Once a user has evaluated every
current candidate at the current `prefVersion`, a rate-limited run sends nothing
to the AI and simply rebuilds that user's feed from reused verdicts.

## Decisions

- **[user] Scope: uniform in `runDigest`.** The rate limit lives inside
  `runDigest`, so it covers the Refresh button, the cron, and e2e through one
  code path. The cron runs once daily, so it is only ever rate-limited if a
  manual refresh occurred in the preceding 5 minutes — an acceptable, negligible
  edge.
- **[AI] "Globally last HN fetch" = latest `stories.fetchedAt`.** Read it by
  selecting `fetchedAt` ordered descending, limit 1 (returns a `Date` via
  Drizzle's timestamp inference — no raw SQL, no `as` cast). `null` when the
  cache is empty.
- **[AI] Window = 5 minutes**, a named constant (`5 * 60 * 1000` ms). Compared as
  `now.getTime() - lastFetch.getTime() < RATE_LIMIT_MS`.
- **[AI] Candidate set when rate-limited = rows where `fetchedAt` equals the
  latest timestamp.** This is exact: every row from one fetch shares one
  `fetchedAt` (stored at second precision), so equality selects precisely the
  last front-page snapshot. Each row is mapped to the `StoryInput` shape
  (`time` = `Math.floor(row.time.getTime() / 1000)`, epoch seconds).
- **[AI] Empty cache (`lastFetch === null`) always fetches HN.** First-ever run
  and a wiped DB behave as today.
- **[AI] Serving up to 5 minutes of stale scores/comment counts is intended.**
  A rate-limited run reads cached `score`/`comments`; refreshing them is exactly
  the HN fetch we are throttling.
- **[AI] Evaluation/feed-rebuild logic is unchanged.** Only candidate resolution
  moves; the version-skip reuse, the empty-preferences top-by-score fallback, and
  the feed rebuild stay exactly as they are.

## Implementation

In [worker/lib/digest.ts](../../../worker/lib/digest.ts), replace the
unconditional fetch-then-upsert prologue of `runDigest` with candidate
resolution:

1. Add `const RATE_LIMIT_MS = 5 * 60 * 1000;` alongside the other module
   constants.
2. Query the latest `fetchedAt` (`select({ fetchedAt }).from(stories)
.orderBy(desc(stories.fetchedAt)).limit(1)`); `lastFetch = rows[0]?.fetchedAt
?? null`. Add `desc` to the existing `drizzle-orm` import (currently
   `and, eq, sql`).
3. If `lastFetch !== null && now.getTime() - lastFetch.getTime() <
RATE_LIMIT_MS`: select all `stories` rows where `fetchedAt` equals
   `lastFetch`, map them to `StoryInput`, and **skip** the story upsert. Log a
   one-line `[digest] rate-limited` note with the candidate count.
4. Otherwise: `candidates = await deps.hn.frontPage()` and run the existing
   chunked story upsert.

The rest of `runDigest` (empty-prefs fallback, version-skip evaluation, feed
rebuild) operates on `candidates` unchanged.

## Tests

Add unit tests to
[worker/lib/digest.test.ts](../../../worker/lib/digest.test.ts) (the existing
harness: direct `runDigest` calls with a controllable `now` and the
call-counting HN client):

1. **Rate-limited within 5 min, no HN fetch.** User A runs at `t0` (HN fetched
   once). User B runs at `t0 + 1 min` with a _fresh counting HN client_: assert
   that client's `fetches()` is `0`, yet B's feed is built from the cached
   snapshot (B's `current` curations match the relevant cached stories).
2. **Rate-limited run evaluates only B's un-judged candidates.** In the same
   within-window scenario, assert the AI was asked to evaluate B's candidates
   (B has none yet) — i.e. the counting filter saw the full candidate count, not
   zero — confirming "only the ones that weren't yet evaluated."
3. **Past the window, HN is fetched again.** A second run at `t0 + 6 min` (fresh
   counting HN client) calls `frontPage()` exactly once.
4. **Empty cache always fetches.** First run on an empty `stories` table fetches
   HN once (covered by existing tests, but assert explicitly if not).
5. **Within-window second run for the same user at the current version sends
   nothing to the AI** and still rebuilds that user's feed from reused verdicts
   (the existing version-skip test already covers same-user reuse with HN
   fetching; add/confirm the rate-limited variant).

### Existing tests that must be updated

Two existing `runDigest` tests do back-to-back calls with `new Date()` and rely
on the **second** call fetching fresh HN data — under the new behavior that
second call is now rate-limited (within 5 min) and reads the frozen cache, so
they must advance `now` past the window on the second run (e.g.
`new Date(Date.now() + 6 * 60 * 1000)`). This keeps each test exercising exactly
what it means to:

- **"refreshes cached story content on a later run"** — second run uses a
  `bumped` HN returning score 999; pass a `now` 6+ min later so HN is actually
  re-fetched and the cache updates.
- **"evaluates only newly appeared stories at the same version"** — second run
  uses a `withNew` HN that adds story 3; pass a `now` 6+ min later so the new
  story is fetched and picked up (`seen === [1]`, feed `[1, 3]` — story 2 is
  non-relevant under the `"rust"` filter).

The remaining back-to-back tests stay correct unchanged, because the frozen
cache equals the fake HN's front page:

- **"isolates feeds per user"** — user B's rate-limited run reads the same cached
  `[1, 2]` and curates by its own filter.
- **"skips stories already evaluated at the current preference version"** —
  second run rate-limited, candidates `[1, 2]` both reused → `seen === [0]`.
- **"re-evaluates every front-page story after a version bump"** — second run
  rate-limited, candidates `[1, 2]`, version bump forces both → `seen === [2]`.

All other existing `runDigest` and api tests must continue to pass.

## Out of scope

- No API/route signature changes, no SPA changes, no schema changes.
- No new rate-limit configuration surface (the 5-minute window is a constant).
- No change to per-user evaluation, archiving, or feed ordering.

```

```
