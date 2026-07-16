# Review 2 — Feeds feature

Reviewed `claude/feeds-feature-fijvvw` at `21fb94e` ("fix: review round 1 —
stream-capped RSS reads, real fallen-out-item e2e"), diffed against
`origin/main`, judged against `docs/specs/feeds/index.md` (including its
Decisions section). Working tree clean. Round-1 settled items (sequential
`runTelegramDigests`, no hashed user tag in the source-failure log, New feed
button not focusing the create form, e2e `linkChat` duplication) were not
re-raised per the review protocol.

## Summary

Both round-1 required fixes are properly done, and the two applied optionals
(link-keyed verdict map, 50-newest cap) are correct as well. A fresh pass over
the full diff — schema/migration, RSS seam, AI prompt split, feeds domain +
routes, cron digests, maintenance, all four SPA pages, and the test suites —
found no new defects. All checks and the full e2e suite are green.

## Round-1 required fixes — verified

1. **5 MB cap enforced while streaming** — fixed. `worker/lib/rss.ts:181-205`
   (`readBodyCapped`) reads `res.body` via `getReader()`, counts raw
   `value.byteLength` BEFORE decoding, cancels the reader and throws
   `RssFetchError` as soon as the running total exceeds the cap; the trailing
   `decoder.decode()` flush on `done` is correct for multi-byte boundaries.
   The cheap `Content-Length` pre-check is kept as a fast path
   (`worker/lib/rss.ts:223-226`). Unit-tested with a chunked stream carrying
   no `Content-Length`: under-cap body returned whole, over-cap aborted
   mid-stream (`worker/lib/rss.test.ts:114-145`).
2. **Archive e2e exercises a fallen-out item** — fixed.
   `e2e/feeds.spec.ts:165-207` now runs a fetch against
   `one.example.com`, swaps the source for `two.example.com` (distinct item
   links via the fake's `origin`-derived URLs), runs again, and asserts the
   feed page shows the rust title once (only the new host's item is current)
   while the archive shows it twice — proving the first fetch's
   `current=false, relevant=true` items render on the archive page only. The
   never-relevant "Sample article 0" stays hidden.

Round-1 optionals applied in the same commit, both correct:

- `worker/lib/feeds.ts:239-244` — verdict lookup is now a link-keyed map
  built once from the synthetic-id → candidate mapping (O(n), and ids out of
  range are safely dropped via `flatMap`).
- `worker/lib/rss.ts:165-175` — items are stable-sorted newest-first before
  the 50-cap (undated → `-Infinity`, so they sort last and, since equal-key
  NaN comparisons count as equal under the stable-sort spec, keep document
  order). Unit-tested with a 60-item oldest-first feed
  (`worker/lib/rss.test.ts:90-101`).

## Checks

| Check               | Result                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `check:format`      | pass                                                                                                |
| `check:lint`        | pass                                                                                                |
| `check:ts`          | pass                                                                                                |
| `check:knip`        | pass                                                                                                |
| `check:dup` (jscpd) | pass (0 clones)                                                                                     |
| `test:unit`         | pass (18 files, 146 tests)                                                                          |
| `test:e2e`          | pass (32 tests), re-run in this round                                                               |
| `check:tf`          | not run — terraform provider downloads blocked in this container (pre-approved skip, not a finding) |

## Findings per axis

### Simplicity — clean

The round-2 changes made the code simpler, not more complex: the map replaces
a quadratic scan, `readBodyCapped` is a small exported pure-ish function
instead of inline buffering. Across the diff, shared machinery is reused
rather than duplicated (`chunk.ts`, `slotMinutes`/`formatSlots`/`dueSlot`,
`SlotTimesEditor`, `runFilter`, `telegramSlotsUpdateSchema`,
`digestRunResultSchema`). No invented abstractions.

### Spec implementation — complete

Everything in scope is present and matches the spec, including all
SA-round-1 decisions: streaming 5 MB cap, `(feedId, url)` unique index,
synthetic-id AI pass before the upsert, sequential cron feeds with the
empty-case message, backlog note at
`docs/0-backlog/newsletter-email-sources.md`. The HN `SYSTEM_PROMPT` and the
`select()` prompt output are byte-identical (the `buildUserPrompt` refactor
keeps the exact `User interests:\n…\n\nStories:\n- id …: … (domain)` text).
Send-once (`sentAt` preserved by upsert omission), ownership-gated routes,
per-feed 429 + `Retry-After`, 60-day pruning of never-relevant non-current
items, four SPA pages + nav tab. Nothing out of scope was built; the HN
homepage pipeline, routes, and `curations` are untouched.

### No shortcuts — clean

No stubs, TODOs, or `as` casts. The three intentional catches (per-source
fetch failure in `runFeedFetch`, per-feed try/catch in `sendDueFeedDigests`,
non-blocking source-remove failure in `FeedSettingsPage`) all either log or
leave the UI retryable, and the first two are spec-mandated. Error messages
surface user-safe end-to-end (`RssFetchError` → route `{ error }` →
`ApiRequestError.message` → settings UI).

### Code quality — clean

Contracts in `shared/`, responses via `schema.parse`, identity only from
`c.get("userEmail")`, chunked upserts within D1's bound-param cap, comments
limited to non-obvious WHYs (the new `readBodyCapped` and stable-sort
comments both explain real footguns). CLAUDE.md docs (`worker/`, `db/`,
`shared/`, `src/`) were updated in the feature commit and accurately describe
the shipped behavior, including the streaming cap and 50-newest rule.

### Tests — broad, one optional note

Unit + e2e coverage matches the spec's list, now including the two round-2
additions (mid-stream cap abort, newest-first capping) and the strengthened
fallen-out-item e2e. Full suites green.

- Minor (optional): the spec's unit list includes ">15 unsent items roll
  over"; the `unsent.slice(0, MAX_STORIES)` + stamp-only-shown composition in
  `worker/lib/scheduled.ts:143-152` has no direct >15-item test, and
  `formatFeedDigestMessage` has no dedicated unit test (it is exercised via
  `scheduled.test.ts` assertions, and its escaping helpers are covered by the
  `formatDigestMessage` suite). The building blocks are individually tested
  (`markFeedItemsSent` stamps exactly the passed ids; `loadUnsentFeedItems`
  filters sent/non-current), so the residual risk is a one-line slice. Worth
  a small test if the digest composition ever grows; not blocking.

## Action list

Required: none.

Optional (no verdict impact):

1. `worker/lib/scheduled.test.ts` — add a >15-unsent-items case asserting 15
   are sent/stamped and the rest stay unsent for the next slot.

VERDICT: APPROVED
