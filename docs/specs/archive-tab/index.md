# Archive tab

## Request (verbatim)

> show an archive tab that shows all non-current posts. Those posts are
> basically stuck there forever, they are never reevaluated or removed from
> there

## Context

The schema already models this. Each morning `runDigest` (`worker/lib/digest.ts`)
sets `curations.current = false` for every existing row of the user, then upserts
the freshly selected stories with `current = true`. Old curations are never
deleted and never re-scored — they simply accumulate as `current = false`. That
set **is** the archive; this feature only exposes it. No change to the digest,
schema, or any selection rule is required.

- `current = true` → the live feed, already served by `GET /api/stories`.
- `current = false` → the archive, currently unexposed.

## Requirements

1. A new read-only endpoint returns the signed-in user's archived curations
   (`current = false`), joined to the shared `stories` cache, ordered **newest
   archived first** (`curations.curatedAt` descending). [user]
2. A new SPA route/tab "archive" renders that list using the existing
   `StoryRow`, identical in look to the home feed (rank, title, domain,
   points/author/time/comments, visited-fade on opened links).
3. Opening an archived story records its first open exactly like the home feed
   (reusing `recordOpen` / `POST /api/stories/:id/open`), so the visited fade
   works there too.
4. An empty archive shows guidance text (no crash, no blank page).
5. Nothing about the digest, the `current` flag lifecycle, or removal behavior
   changes — archived posts stay forever and are never re-evaluated.

## Decisions

- **Ordering: newest first by `curatedAt` desc.** [user] The archive is a
  historical record; most recently displaced editions sit at the top.
- **Endpoint: `GET /api/stories/archive`** mounted on the existing
  `storiesRoutes`. [AI] Reuses the route group, the `FeedRow`/`toStory`
  serializer, and the `storyListSchema` contract — the response shape is
  identical to the feed, so **no new `shared/` schema is added**.
- **No new shared schema; reuse `storyListSchema` + `Story`.** [AI] Archived
  rows carry the same fields (`relevanceScore`, `reason`, `openedAt`).
- **No pagination / no limit — return all archived rows.** [AI] The request says
  "all non-current posts"; for a single-user personal app the archive grows
  slowly. Pagination is explicitly out of scope.
- **Archive data fetched on its own via `useCachedFetch("/api/stories/archive")`,
  not added to `FeedContext`.** [AI] `FeedContext` lifts the _current_ feed so
  the header Refresh button and home list share one source; the archive is an
  independent read with no Refresh coupling. The page reuses `useFeed().recordOpen`
  for open tracking only.
- **Nav order: `top` · `archive` · `preferences`.** [AI] Archive sits next to
  the feed it mirrors.
- **Digest, `current` lifecycle, and DB untouched.** [AI] The archive already
  exists as a side effect of the daily `current=false` sweep.

## Implementation outline

### Worker — `worker/routes/stories.ts`

Add a `GET /archive` handler before the `/:id/open` route. Same select as the
feed query, but:

- `where(and(eq(curations.userEmail, ...), eq(curations.current, false)))`
- `orderBy(desc(curations.curatedAt))`

Return `{ stories: rows.map(toStory) }`, the same as `GET /`.

### SPA

- `src/pages/ArchivePage.tsx` — new page. `useCachedFetch("/api/stories/archive",
storyListSchema)` for data + `useFeed().recordOpen` for opens. Mirror
  `HomePage`'s loading/error/empty/list structure; empty copy explains archived
  posts appear after a morning digest replaces the feed.
- `src/App.tsx` — add `<Route path="archive" element={<ArchivePage />} />` inside
  the `Layout` route.
- `src/components/Layout.tsx` — add an `archive` `NavLink` between `top` and
  `preferences`.

## Tests (e2e — `e2e/archive.spec.ts`)

Drive the archive into existence via two digests with different preferences
(the fake AI selects stories whose title contains a preference keyword):

1. **Archived posts appear; current ones do not.** PUT prefs `rust`, run digest
   (Rust story → current). PUT prefs `bitcoin`, run digest (Rust archived,
   Bitcoin current). Visit `/archive`: the Rust story is visible; the Bitcoin
   story (current) is **not** on the archive page. Visit `/`: inverse.
2. **Empty archive shows guidance.** Fresh user → `/archive` shows the guidance
   text, not a story list.
3. **Opening an archived story records the open (visited fade).** From an
   archive with the Rust story, click it, reload `/archive`, assert the link has
   the muted/visited class (consistent with how `home.spec.ts` asserts rendered
   rows).

Existing home/preferences specs must stay green.

## Out of scope

- Pagination, search, or filtering of the archive.
- Re-scoring, de-duping, or removing archived posts.
- Showing `relevanceScore`/`reason` (not shown in the feed in v1 either).
- Any change to the digest or the `current` flag mechanics.
