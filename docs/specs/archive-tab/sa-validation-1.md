# SA Validation — Archive tab

Spec: `docs/specs/archive-tab/index.md`
Reviewer: senior solutions architect (design gate, no code written)

## Summary

The spec exposes data that already exists. `runDigest` sweeps every curation row
for the user to `current = false`, then upserts the new selection as
`current = true`; old rows accumulate untouched as the archive (verified in
`worker/lib/digest.ts:130-157` and the schema comment in `db/schema.ts:23-25`).
The feature is purely additive: one read-only worker route, one SPA page, one
nav link, one route registration. No schema, digest, contract, or invariant
changes. This is correctly scoped, fits the codebase, reuses the right
abstractions, and carries no blocking risk. Approved.

## Findings per axis

### Soundness — solves the problem, right shape

Sound. The request ("show all non-current posts; never re-evaluated or removed")
maps exactly to `curations.current = false`. The spec adds an endpoint that
selects on that flag and an identical-looking page. Requirement 5 (nothing about
the lifecycle changes) is satisfied for free because the archive is a passive
read of existing rows — confirmed: no code path other than `runDigest` writes
`current`, and `/open` only touches `openedAt`.

The proposed query is a correct mirror of the feed query in
`worker/routes/stories.ts:12-37`: same column projection, same
`innerJoin(stories)`, swapping `eq(curations.current, true)` →
`eq(curations.current, false)` and the `orderBy` to `desc(curations.curatedAt)`.
The existing `toStory` serializer (`worker/lib/serialize.ts`) handles the row
shape unchanged, so `storyListSchema` is the right contract to reuse.

### Right-sizing — simplest correct

Correctly right-sized; no over- or under-engineering.

- No new `shared/` schema: justified — the archive row shape is byte-identical to
  a feed row, so `storyListSchema` / `Story` already cover it. Adding a schema
  would be redundant and CLAUDE.md forbids "export for later."
- Not added to `FeedContext`: correct. `FeedContext` exists to couple the header
  Refresh button + home list to one revalidating source (see
  `src/context/FeedContext.tsx:36-55`). The archive has no Refresh coupling, so a
  standalone `useCachedFetch("/api/stories/archive", storyListSchema)` is the
  simpler, honest fit. Reusing `useFeed().recordOpen` for opens is fine — it is a
  fire-and-forget `POST /api/stories/:id/open` with no dependency on feed state.
- No pagination/limit: defensible for a single-user app whose archive grows by at
  most ~30 rows/day. Returning all rows keeps the contract identical. Noted as a
  long-horizon scaling note below, not a blocker.

### Codebase fit — reuse over reinvent, invariants intact

Strong fit. The page mirrors `HomePage` (`src/pages/HomePage.tsx`) structure
(error / loading / empty / `<ol>` of `StoryRow`). `StoryRow`
(`src/components/StoryRow.tsx:29-32`) already renders the visited fade purely
from `story.openedAt !== null`, so requirement 3 works with zero new component
logic. Route registration matches the existing pattern in `src/App.tsx:11-16`
(child routes under the `Layout` route). Nav link matches `src/components/
Layout.tsx:21-26`.

No invariant is broken: the digest's `current` lifecycle, the DST cron guard, and
upsert behavior are untouched. The endpoint is mounted inside `storiesRoutes`,
already behind `authMiddleware` and the deps injector (`worker/index.ts:13-25`),
so auth and per-user scoping (`c.get("userEmail")`) come for free.

### Risk / gaps / edge cases

- **Hono route ordering (verify on implement, not a design flaw).** The spec says
  to add `GET /archive` "before the `/:id/open` route." With Hono's default
  router, a literal segment `/archive` and a param segment `/:id` do not collide
  for `GET /archive` (different paths; `/:id/open` requires a second segment).
  Ordering is therefore not strictly required for correctness, but placing
  `/archive` before `/:id/open` as the spec states is harmless and matches the
  request grouping. No action needed.
- **Ordering field semantics.** `curatedAt` is set to `now` for every selected
  (current) row each run and bumped via `excluded.curated_at` on survivors
  (`worker/lib/digest.ts:151`). An archived row therefore carries the `curatedAt`
  of the last digest in which it was current — i.e. the morning it was displaced
  is _not_ recorded; what is recorded is the last edition it belonged to. "Newest
  archived first" via `desc(curatedAt)` still yields the intended "most recently
  displaced editions at the top," because all stories from one edition share that
  edition's timestamp and a later edition has a strictly greater `now`. Ties
  within one edition are unordered (acceptable; same-day batch). This matches the
  user decision. No change needed, but the implementer should not expect a
  distinct "archived-at" timestamp — there isn't one.
- **e2e test #3 (re-selection edge).** The test drives the archive by running a
  `rust` digest then a `bitcoin` digest. This is valid because the fake AI
  (`worker/lib/fakes.ts:89-108`) only marks the Rust story relevant for `rust`
  prefs, so after the `bitcoin` run the Rust row is swept to `current = false`
  and never re-upserted — it stays archived. The test is sound against the real
  fakes. Note for the implementer: opening the Rust story must happen while it is
  on the archive page (its `openedAt` is set on a `current = false` row), and the
  open endpoint keys only on `(userEmail, storyId)` regardless of `current`
  (`worker/routes/stories.ts:47-53`), so the fade persists. Correct.
- **Empty-state divergence from home copy.** Requirement 4 + the outline call for
  archive-specific guidance ("archived posts appear after a morning digest
  replaces the feed"), distinct from HomePage's "No stories yet" copy. Good —
  reusing HomePage's copy verbatim would be wrong here. Just ensure the e2e empty
  assertion targets the archive copy, not `/No stories yet/`.

### Scaling note (non-blocking)

Unbounded archive returns all rows in one payload and one `useCachedFetch` parse.
At ~30/day this is ~11k rows/year — fine for years. Out-of-scope per the spec and
correctly deferred; flagging only so it is a conscious deferral, not an oversight.

## Open questions

None material. One soft confirmation:

- Should the archive nav link use `end` like the `/` link, or default matching?
  Recommended answer: `/archive` is a leaf path with no children, so plain
  `NavLink to="/archive"` (no `end`) is correct and matches the `preferences`
  link. No spec change required.

## Spec-change list

None required. The spec is implementable as written. The notes above
(route-ordering is optional, `curatedAt` is last-current not displaced-at, empty
copy must differ from home) are implementation guidance, not spec defects.

VERDICT: APPROVED
