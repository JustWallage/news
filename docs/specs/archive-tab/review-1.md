# Archive tab — review 1

## Summary

The change exposes the already-existing `current = false` curation set as a new
"archive" tab. Scope matches the spec exactly: a new `GET /api/stories/archive`
worker handler, an `ArchivePage` SPA route/tab reusing `StoryRow`, the nav link
ordered `top · archive · preferences`, and three e2e specs. No digest, schema,
`shared/`, or `current`-lifecycle changes. `pnpm check` is green (exit 0,
30 unit tests pass) and the full e2e suite passes (7/7, including the 3 new
archive specs).

Note: `git diff main` overstates the change because `main` advanced past this
branch's base commit (`d0b0d9b`). The actual branch diff (`d0b0d9b..archive-tab`)
touches only: `worker/routes/stories.ts`, `src/App.tsx`, `src/components/Layout.tsx`,
`src/pages/ArchivePage.tsx`, `src/CLAUDE.md`, `e2e/archive.spec.ts`, and the spec
docs. The digest/schema/preferences changes in the raw `main` diff are unrelated
prior commits, not part of this work.

## Findings per axis

### Simplicity — clean

`curatedStories()` factors the shared select out of the feed and archive handlers,
with the caller supplying the `orderBy`. This is the simplest correct shape: one
query builder, two thin handlers differing only by the `current` boolean and sort.
ArchivePage mirrors HomePage's loading/error/empty/list structure without
duplication of concern.

### Spec implementation — clean

All five requirements are met, nothing invented:

1. Read-only `GET /api/stories/archive` filters `current = false`, orders
   `desc(curations.curatedAt)` (`worker/routes/stories.ts:49-56`). Matches the
   "newest archived first" decision.
2. `/archive` route + `ArchivePage` renders the list via `StoryRow`, identical to
   home (`src/pages/ArchivePage.tsx`, `src/App.tsx:15`).
3. Opens reuse `useFeed().recordOpen` → `POST /api/stories/:id/open`; that handler
   matches on `userEmail + storyId` with no `current` filter, so archived rows
   record opens correctly (`worker/routes/stories.ts:59-86`).
4. Empty archive shows guidance text (`ArchivePage.tsx`, "Nothing archived yet…").
5. No digest/schema/`current` changes — confirmed by the branch diff.

Decisions honored: response reuses `storyListSchema` (no new shared schema);
archive fetched via its own `useCachedFetch("/api/stories/archive")`, not added to
`FeedContext`; nav order `top · archive · preferences`.

Route ordering: `/archive` is a static path; Hono matches it ahead of `/:id/open`
regardless of registration position, so there is no collision (verified by the
passing e2e "shows displaced posts" test which hits the archive endpoint).

`useFeed()` in ArchivePage is safe because `FeedProvider` wraps the `Outlet` in
`Layout` (`src/components/Layout.tsx:46-55`).

### No shortcuts — clean

No TODOs, stubs, swallowed errors, or hacks introduced. Error/loading/empty states
are all handled. The fire-and-forget `recordOpen` swallow is pre-existing
FeedContext behavior (best-effort open tracking), not new here.

### Code quality — clean

Follows conventions: no `as` casts, types come from the shared schema and Drizzle
inference, comments are short and explain the non-obvious (why archive accumulates
forever, why ordering is caller-supplied). `src/CLAUDE.md` is updated in the same
change to document the new route and the "own `useCachedFetch`, NOT in FeedContext"
invariant — matches the docs standard.

### Tests — clean

`e2e/archive.spec.ts` covers all three behaviors the spec asks for: archived vs
current separation (both directions), empty-archive guidance, and visited-fade after
opening an archived story. The visited assertion checks `text-muted-foreground`,
consistent with `StoryRow.tsx:31`. Existing home specs stay green.

## Action list

None.

VERDICT: APPROVED
