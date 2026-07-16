# Feeds — user-created RSS feeds with AI curation

## Request (verbatim)

> Add the "feeds" feature. A new tab, on which you can create multiple feeds
> for yourself, when you select a feed on the feeds tab it displays at the top
> in a dropdown where you can switch to other feeds, and also you can go back
> to the feeds overview page (the overview page contains a list of cards for
> each feed, with the title, and preferences entry). A feed consists of one or
> more sources, first of all rss feeds. You enter an rss feed url and it must
> use an rss library to parse it. Also a feed contains a title, and an AI
> curation input (similar to preferences for the HN feed). Also if you've
> connected telegram, a feed contains telegram timeslots on which it'll send
> you the curated versions of the feed's sources. If not too hard rn, also add
> the ability to generate/get an email address that you can use to enter on
> other platforms' newsletter signups, so you get the newletters as a feed
> source. The feed should use the titles and links to determine whether it's
> in line with the user's preferences. The homepage for the HN feed should
> remain untouched, the feeds page should display the latest 20 feed items
> from the last fetch for the selected feed, and it should display a settings
> button that continues to the settings page for that feed (preferences input,
> sources, telegram slots), and a button to create a new feed.

## Context

The app today is a single AI-curated HN front page per user: `worker/lib/hn.ts`
fetches Algolia, `worker/lib/digest.ts` curates against the user's single
`preferences` blob via `worker/lib/ai.ts` (Workers AI Llama 70B), results land
in `curations` and render on the SPA homepage. Telegram daily slots live on the
`telegram` table (`slot1..slot3` minute-of-day + `timezone`), matched by the
`*/5` cron via `dueSlot` + `minuteOfDayInTz`.

This feature adds a parallel, per-user "feeds" system: each user creates any
number of feeds; a feed has a title, its own AI-curation preferences text, one
or more RSS sources, and (when Telegram is linked) its own daily slots. The HN
homepage pipeline and UI stay untouched.

## Scope

### In scope

- New tables `feeds`, `feed_sources`, `feed_items` + one additive migration.
- RSS ingestion via an RSS parsing library that runs in workerd (no
  `nodejs_compat`): **feedsmith** (pure TS, RSS/Atom/RDF/JSON Feed, edge
  compatible). Fallback if it fails in workerd at implementation time:
  `@rowanmanning/feed-parser`.
- AI curation of feed items on **title + link domain only**, reusing the
  existing batching/parsing machinery in `worker/lib/ai.ts` with a separate
  feed-specific system prompt (the HN prompt stays byte-identical).
- New API surface under `/api/feeds` (contracts in `shared/api.ts` first).
- SPA: new "feeds" nav tab; overview page (cards: title + preferences entry,
  "New feed"); feed page (feed-switcher dropdown, back-to-overview, latest ≤20
  curated items from last fetch, Refresh, Settings button, New feed button);
  settings page (title, preferences, sources add/remove, telegram slots,
  delete feed).
- Cron: per-feed Telegram digests at the feed's slots (owner's `telegram`
  timezone + chat), alongside the existing HN digests.
- Maintenance: prune stale non-current feed items.
- Unit + e2e coverage; fakes for RSS in e2e.

### Explicitly OUT of scope

- Newsletter email-address source — **deferred to the backlog
  (`docs/0-backlog/newsletter-email-sources.md`)**
  (requires Cloudflare Email Routing infra: Terraform, DNS, catch-all rule,
  worker `email()` handler, MIME parsing; email was already deferred once in
  `docs/1-in-progress/email-signup.md`). The `feed_sources` design keeps this
  additive (a future `kind` column defaulting to `'rss'`).
- Any change to the HN homepage feed, its routes, its prompt, or `curations`.
- Read-tracking (`openedAt`) for feed items.
- Sharing feeds between users; public feed pages.
- Per-feed timezone (reuses the user-level `telegram.timezone`).

## Current behaviour (verified files)

- `db/schema.ts` — tables `stories`, `curations`, `preferences`, `telegram`
  (slot1/2/3 minute-of-day ints, `timezone` IANA text), `sessions`,
  `digest_runs`. Migrations in `db/migrations/` via `pnpm migrate:gen`;
  additive only.
- `worker/lib/deps.ts` — `Deps { hn, ai, telegram }`; fakes when
  `ENVIRONMENT==="e2e"` or `env.AI` undefined. THE single env branch.
- `worker/lib/ai.ts` — `makeRealAiFilter(ai)`: `BATCH_SIZE=20`, model
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, prompt lines
  `- id {id}: {title} ({domain})`, response `{"relevant":[{id,score}]}`,
  helpers `parseRelevant`, `verdictsFor` exported for tests.
- `worker/lib/digest.ts` — `curateForUser` pattern: verdict reuse keyed on
  `prefVersion`, empty-prefs fallback, `current` flag reset + chunked upsert
  (`CURATION_CHUNK=10`, D1 100-bound-param cap), `RATE_LIMIT_MS=5min`.
- `worker/lib/scheduled.ts` — `sendDueDigests` filters telegram rows due via
  `dueSlot(row, minuteOfDayInTz(now, row.timezone ?? "Europe/Amsterdam"))`;
  `worker/index.ts` `scheduled` runs it + `runScheduledMaintenance` in
  `ctx.waitUntil(Promise.all([...]))`.
- `worker/lib/telegram-bot.ts` — `saveSlots`, `dueSlot`, `loadChatId`,
  `formatMinuteOfDay`, `parseDailyTime` (HH:MM → minute-of-day rounded to 5).
- `worker/lib/telegram.ts` — `formatDigestMessage(stories, appUrl)` (HTML,
  escaping, `MAX_STORIES=15`).
- `worker/lib/rate-limit.ts` — `digestCooldownRemainingMs` /
  `recordDigestRun` back the 429 + `Retry-After` on `POST /api/digest/run`
  (`DIGEST_COOLDOWN_SECONDS`, 0 in local/e2e, 600 prod).
- `shared/api.ts` — all cross-boundary contracts (zod v4);
  `PREFERENCES_MAX_LENGTH=1000`, `telegramSlotsUpdateSchema`
  (`{ slots: (HH:MM | null)[] length 3 }`), `isHttpUrl`.
- SPA: react-router v7 routes in `src/App.tsx`; reads via
  `src/hooks/useCachedFetch.ts` (module cache + revalidate), writes via
  `apiFetch` (`src/lib/api.ts`); nav in `src/components/Layout.tsx`
  (top/archive/preferences NavLinks + Refresh); `src/context/FeedContext.tsx`
  owns the HN feed (names `FeedProvider`/`useFeed` are TAKEN — feeds code must
  not collide).
- e2e: `e2e/fixtures.ts` header-auth per-test user; fakes drive HN/AI/telegram
  hermetically; `linkChat`-style webhook helper in `e2e/telegram.spec.ts`.
- Checks: `pnpm check` (format, eslint incl. no-`as`-casts, tsc, knip, jscpd
  `threshold 1`, terraform, vitest-pool-workers unit tests). Playwright e2e
  on port 5174.
- Workers constraints: 50-subrequest cap per invocation, D1 ~100 bound params
  per statement, no `nodejs_compat` flag.

## Design

### 1. Schema + migration (`db/schema.ts`, `pnpm migrate:gen`)

```ts
feeds:        id int PK autoincrement,
              userEmail text notNull,
              title text notNull,
              preferencesText text notNull default "",
              prefVersion int notNull default 1,
              slot1 / slot2 / slot3 int nullable   // minute-of-day, like telegram
              lastFetchedAt timestamp nullable,
              createdAt timestamp notNull
              index on userEmail

feed_sources: id int PK autoincrement,
              feedId int notNull → feeds.id,
              url text notNull,
              title text notNull,                  // channel title captured at add-time
              createdAt timestamp notNull
              uniqueIndex on (feedId, url)

feed_items:   id int PK autoincrement,
              feedId int notNull → feeds.id,
              link text notNull,
              title text notNull,
              publishedAt timestamp nullable,
              fetchedAt timestamp notNull,
              relevant boolean notNull default true,
              relevanceScore int notNull default 0,
              prefVersion int notNull default 0,   // verdict reuse, mirrors curations
              current boolean notNull,             // member of last fetch AND relevant
              sentAt timestamp nullable            // stamped when delivered to Telegram; send-once guard
              uniqueIndex on (feedId, link)        // dedupe across fetches & sources
```

Export row types `FeedRow`, `FeedSourceRow`, `FeedItemRow`. One migration,
additive. No `reason` column (feed prompt returns id+score only). Timezone is
NOT duplicated: slots are interpreted in the owner's `telegram.timezone`.

### 2. Shared contracts (`shared/api.ts`)

```ts
FEED_TITLE_MAX_LENGTH = 100
MAX_FEED_SOURCES = 10

feedSummarySchema   = { id: int, title: string, preferencesText: string }
feedListSchema      = { feeds: FeedSummary[] }
feedCreateSchema    = { title: string.trim().min(1).max(100) }
feedCreatedSchema   = { id: int }
feedUpdateSchema    = { title: as create, preferencesText: string.max(PREFERENCES_MAX_LENGTH) }
feedSourceSchema    = { id: int, url: string, title: string }
feedDetailSchema    = { id, title, preferencesText,
                        sources: FeedSource[],
                        slots: (HH:MM string | null)[] length 3,
                        telegramLinked: boolean,
                        lastFetchedAt: iso.datetime | null }
feedSourceCreateSchema = { url: string.refine(isHttpUrl) }
feedItemSchema      = { id: int, title: string, url: string,
                        publishedAt: iso.datetime | null, relevanceScore: int }
feedItemListSchema  = { items: FeedItem[], lastFetchedAt: iso.datetime | null }
```

Slot update reuses the existing `telegramSlotsUpdateSchema` shape (same
`{ slots }` body). `digestRunResultSchema` (`{ count }`) is reused for run.

### 3. RSS library + client seam (`worker/lib/rss.ts`, `worker/lib/deps.ts`)

- Dependency: `feedsmith`. Parse with its universal `parseFeed(xml)`;
  normalize to `ParsedRssFeed { title: string, items: { title, link,
publishedAt: Date | null }[] }`.
- `RssClient { fetch(url: string): Promise<ParsedRssFeed> }`.
  `realRssClient`: `fetch(url)` (Accept `application/rss+xml, application/atom+xml,
application/xml, text/xml;q=0.9, */*;q=0.8`), non-2xx or parse failure →
  throw `RssFetchError` (message safe to surface); bodies over 5 MB rejected
  (resource-abuse guard on user-supplied URLs). Normalization drops items
  with empty titles or non-`isHttpUrl` links, caps at 50 newest per source.
- Pure parse/normalize function exported for unit tests (pattern:
  `parseRelevant` in `ai.ts`).
- `Deps` gains `rss: RssClient`; `createDeps` returns `fakeRssClient` in the
  same branch that fakes hn/ai (e2e or no AI binding).
- `fakeRssClient` (`worker/lib/fakes.ts`): keyed off URL — URLs containing
  `"bad"` throw `RssFetchError`; otherwise return a canned channel (title
  derived from URL) with a handful of items whose titles carry keywords
  (`Rust`, `Bitcoin`, …) so `fakeAiFilter`-style keyword matching works, plus
  filler items.

### 4. AI curation for feed items (`worker/lib/ai.ts`)

- Judge on titles + link domains only (per request). Extract the shared core
  of `makeRealAiFilter` into an internal
  `runFilter(systemPrompt, prefs, lines: {id, title, domain}[])` used by both
  paths; `AiFilter` gains `selectFeedItems(preferences, items: {id, title,
domain}[]): Promise<Verdict[]>`.
- The HN system prompt and `select()` behaviour stay **byte-identical**. The
  feed system prompt is the same strict-filter contract with "personal Hacker
  News feed" → "personal news feed of articles from the user's own sources"
  and "stories" → "articles"; identical JSON output contract so
  `parseRelevant`/`verdictsFor` are reused as-is.
- `fakeAiFilter` implements `selectFeedItems` with the same keyword logic.

### 5. Worker — feeds domain logic (`worker/lib/feeds.ts`, new)

- `loadFeeds(db, userEmail)` → summaries ordered by `createdAt`.
- `createFeed(db, userEmail, title, now)` → id.
- `loadFeedForUser(db, userEmail, feedId)` → `FeedRow | null` (ownership gate
  used by every `/:id` route; null → 404).
- `updateFeed(db, feed, { title, preferencesText }, now)` — bumps
  `prefVersion` only when `preferencesText` actually changed (mirrors
  `savePreferences`).
- `deleteFeed(db, feedId)` — deletes feed + its sources + items (explicit
  deletes; no FK cascade assumptions).
- `addFeedSource(db, rss, feed, url, now)` — 409-style error when the feed
  already has `MAX_FEED_SOURCES`; duplicate URL on the same feed rejected;
  validates by `rss.fetch(url)` and stores the source with the channel title.
  Returns the source row.
- `removeFeedSource(db, feed, sourceId)`.
- `runFeedFetch(db, deps, feed, now)`:
  1. Load sources; none → `{ count: 0 }` without touching AI.
  2. `Promise.all` over sources with per-source try/catch — a failing source
     logs (hashed user tag, source id) and contributes zero items; the run
     survives.
  3. Merge + dedupe by link (first wins), attach `publishedAt`.
  4. Load existing `feed_items` for the feed's links; verdicts with
     `prefVersion === feed.prefVersion` are reused; only the rest go to
     `ai.selectFeedItems` (empty `preferencesText` → everything relevant,
     score 0, AI-free — the page then shows latest 20 unfiltered). The AI
     pass runs BEFORE the upsert, so unsaved items get synthetic ids (array
     index) for the prompt/verdict mapping — never upsert first and judge
     second (that would break the single-pass `current = relevant` write).
  5. `UPDATE feed_items SET current=false WHERE feedId=?`, then chunked
     upsert (10 rows/statement) of every fetched item:
     `current = relevant`, `relevant`, `relevanceScore`, `prefVersion`,
     `fetchedAt = now`, keep `publishedAt`.
  6. Set `feeds.lastFetchedAt = now`. Return `{ count: relevant }`.
- `loadFeedItems(db, feedId)` → `current = true`, ordered
  `publishedAt DESC NULLS LAST, fetchedAt DESC, id DESC`, `LIMIT 20`.
- `loadFeedArchive(db, feedId)` → ALL `relevant = true` items ever for the
  feed (current or not), same ordering, no limit — backs the feed's archive
  page.
- Serialization to API shapes via `schema.parse` (pattern:
  `worker/lib/serialize.ts`).

### 6. Worker — routes (`worker/routes/feeds.ts`, mounted `/api/feeds` in `worker/index.ts`)

| Route                           | Behaviour                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                         | `feedListSchema` for `c.get("userEmail")`                                                                                                                                                                |
| `POST /`                        | body `feedCreateSchema` (400 invalid) → `feedCreatedSchema`                                                                                                                                              |
| `GET /:id`                      | 404 unknown/foreign id → `feedDetailSchema` (slots formatted `formatMinuteOfDay`; `telegramLinked` via `loadChatId`)                                                                                     |
| `PUT /:id`                      | body `feedUpdateSchema` → `{ ok: true }`                                                                                                                                                                 |
| `DELETE /:id`                   | idempotent → `{ ok: true }`                                                                                                                                                                              |
| `PUT /:id/slots`                | 409 when telegram not linked (mirrors `/api/telegram/slots`); body `telegramSlotsUpdateSchema` → writes `slot1..3` via `parseDailyTime` semantics → `{ ok: true }`                                       |
| `POST /:id/sources`             | body `feedSourceCreateSchema` (400 invalid url); 409 at `MAX_FEED_SOURCES` or duplicate url; 400 + safe message when the RSS fetch/parse fails → `feedSourceSchema`                                      |
| `DELETE /:id/sources/:sourceId` | idempotent → `{ ok: true }`                                                                                                                                                                              |
| `GET :id/items`                 | `feedItemListSchema` (current top ≤20)                                                                                                                                                                   |
| `GET :id/archive`               | `feedItemListSchema` (all relevant items ever)                                                                                                                                                           |
| `POST /:id/run`                 | per-feed cooldown off `feeds.lastFetchedAt` vs `DIGEST_COOLDOWN_SECONDS` → 429 + `Retry-After` (reuse the remaining-ms helper pattern in `rate-limit.ts`); else `runFeedFetch` → `digestRunResultSchema` |

`:id` parsed as positive int (400 otherwise). All handlers go through
`loadFeedForUser` — no cross-user access.

### 7. Worker — cron + maintenance (`worker/lib/scheduled.ts`, `worker/lib/maintenance.ts`)

- Generalize `dueSlot` to accept `{ slot1, slot2, slot3 }` (structural — the
  existing telegram call sites compile unchanged).
- `sendDueFeedDigests(db, deps, appUrl, now)`: join feeds having any slot set
  with their owner's telegram row (`chatId` not null); due when
  `dueSlot(feed, minuteOfDayInTz(now, telegramRow.timezone ?? TZ))`. For each
  due feed: `runFeedFetch` (scheduled runs bypass the cooldown, like HN
  digests) → load the feed's **unsent** current items (`current = true AND
sentAt IS NULL`, page ordering), take the first 15 (the `MAX_STORIES`
  cap) → `telegram.sendMessage(chatId, formatFeedDigestMessage(feed.title,
items, appUrl))` → stamp `sentAt = now` on exactly the items included in
  the message. **Send-once invariant:** a feed item is delivered to
  Telegram at most once, ever — already-sent items are excluded from later
  digests even while they still appear in the feed page's top 20; items
  beyond the 15-cap stay unsent and roll over to the next slot. Due feeds
  are processed **sequentially** with per-feed try/catch: one cron tick
  shares the 50-subrequest cap across all due feeds + HN digests, so
  sequential processing degrades gracefully (earlier feeds deliver if a
  later one exhausts the budget). Zero unsent items still sends a "nothing
  new" message, mirroring `formatDigestMessage`'s empty case — a configured
  slot is an explicit opt-in to a daily message.
- `worker/index.ts` `scheduled`: add `sendDueFeedDigests` to the existing
  `Promise.all`.
- `formatFeedDigestMessage(title, items, appUrl)` in `worker/lib/telegram.ts`,
  sharing the HTML-escaping helpers with `formatDigestMessage`, max 15 items,
  footer link `${appUrl}/feeds`.
- `runScheduledMaintenance` purge tick additionally deletes `feed_items`
  where `relevant = false AND current = false AND fetchedAt < now - 60 days`
  (bounds growth; relevant items are the feed's archive and are never
  pruned).

### 8. SPA

Routes in `src/App.tsx` (inside the authed `Layout` route):

- `feeds` → `FeedsPage` (overview)
- `feeds/:feedId` → `FeedPage`
- `feeds/:feedId/archive` → `FeedArchivePage`
- `feeds/:feedId/settings` → `FeedSettingsPage`

Nav: add `feeds` NavLink in `src/components/Layout.tsx` (top / feeds /
archive / preferences). The header Refresh button keeps its HN-only meaning
(it lives with `useFeed()`; feed pages have their own Refresh).

- **`FeedsPage`** — `useCachedFetch("/api/feeds", feedListSchema)`. Card per
  feed (title + preferences text, clamped) linking to `/feeds/:id`; a "New
  feed" affordance: title input + Create → `POST /api/feeds` → navigate to
  `/feeds/:id/settings`. Empty state copy when no feeds.
- **`FeedPage`** — top bar: `<select>` of the user's feeds (value = current
  id; change → `navigate(/feeds/:id)`), "All feeds" link back to `/feeds`,
  Settings button → `/feeds/:id/settings`, Archive link →
  `/feeds/:id/archive`, New feed button → `/feeds` (focus/anchor the create
  form), Refresh button → `POST /api/feeds/:id/run` then revalidate items
  (disabled while running; 429 surfaces its message).
  Body: `useCachedFetch("/api/feeds/:id/items", feedItemListSchema)`; item
  rows (new lean `FeedItemRow`: title link via `safeHref`, hostname,
  `relativeTime(publishedAt)`) — `StoryRow` is HN-shaped (score/comments) and
  is not reused. Empty states: no sources yet (point to settings), fetched
  but nothing relevant.
- **`FeedArchivePage`** — `useCachedFetch("/api/feeds/:id/archive",
feedItemListSchema)`; same `FeedItemRow` list, all curations ever for the
  feed; back link to `/feeds/:id`.
- **`FeedSettingsPage`** — loads `feedDetailSchema`. Sections: title +
  preferences (dirty-ref seeding + Save → `PUT`, the `PreferencesPage`
  pattern); sources (list with per-source remove via `ConfirmDialog`-less
  simple button, add-URL input → `POST`, surface 400/409 messages); telegram
  slots (only when `telegramLinked`: three `<input type="time" step={300}>`
  - Save → `PUT /:id/slots`, the `TelegramSection` pattern; otherwise a hint
    linking to `/preferences`); danger zone: Delete feed via `ConfirmDialog` →
    `DELETE` → navigate `/feeds`.

No new context provider: pages own their `useCachedFetch` state (the
`ArchivePage` pattern). Names avoid the taken `FeedContext`/`useFeed`.

### 9. Backlog + docs notes

New `docs/0-backlog/newsletter-email-sources.md` (per-idea file convention):
newsletter-email feed sources (per-feed generated address via Cloudflare
Email Routing catch-all → worker `email()` handler → MIME parse →
`feed_items`), including why it was deferred. Update `worker/CLAUDE.md` (or
nearest doc) same commit: `worker/lib/feed.ts` is HN-only, `worker/lib/feeds.ts`
is the user-feeds domain.

## Tests

### Unit — `worker/**/*.test.ts` (vitest-pool-workers, real D1)

- `rss.test.ts`: normalize parses RSS 2.0 and Atom fixtures (title, link,
  pubDate); drops titleless/non-http items; caps at 50; parse failure throws
  `RssFetchError`.
- `feeds.test.ts`: `updateFeed` bumps `prefVersion` only on real prefs
  change; `runFeedFetch` dedupes by link across sources and fetches, reuses
  verdicts at matching `prefVersion` (AI called only for new/stale items),
  empty-prefs marks all relevant without AI, failing source doesn't kill the
  run, `current` flags reset correctly; `loadFeedItems` orders by
  `publishedAt` desc and limits to 20; `loadFeedArchive` returns all
  relevant items ever (current or not) and never non-relevant ones;
  `deleteFeed` removes sources + items.
- `ai` additions: feed prompt path returns verdicts via shared parsing
  (existing `parseRelevant`/`verdictsFor` tests already cover the core).
- Routes: ownership (foreign feed id → 404), create/update validation 400s,
  slots 409 when unlinked, source add 409 at cap, run 429 under cooldown
  (route-test pattern of the existing suites).
- `scheduled` additions: `sendDueFeedDigests` sends only for due slots in the
  owner's timezone and skips feeds whose owner has no chat; sends each item
  at most once (`sentAt` stamped; a second due slot excludes them) while the
  items stay in the page's top 20; >15 unsent items roll over.
- Maintenance: stale non-relevant, non-current feed items pruned; current
  and relevant (archive) ones kept.

### e2e — `e2e/feeds.spec.ts` (fixtures auth, fake rss/ai)

- Create a feed from the overview, land on settings, add a source, set
  preferences, go to the feed page, Refresh → keyword-matching items appear
  (≤20), non-matching absent.
- Overview shows a card with title + preferences text.
- Two feeds: dropdown switches between them; "All feeds" returns to overview.
- Adding a source with a failing URL surfaces an error and stores nothing.
- Slots hidden when telegram unlinked; after webhook-linking (existing
  helper), slots save and reload on the feed's settings.
- Archive page lists items that fell out of the current top 20 as well as
  current ones.
- Delete feed → gone from overview.
- Homepage still shows the HN feed untouched (existing `home.spec.ts` keeps
  passing).

## Verification

- `pnpm check` green (includes unit tests, lint no-`as`, knip, jscpd).
- `pnpm test:e2e` green including the new `feeds.spec.ts`.
- Manual: `pnpm dev`, create a feed with a real RSS URL (e.g. hnrss.org),
  set preferences, Refresh, confirm curated items render; confirm HN homepage
  unchanged.

## Decisions

- **[user]** Feeds live on a new tab; overview = cards (title + preferences
  entry); feed page = dropdown switcher, back-to-overview, latest ≤20 items
  from last fetch, Settings + New feed buttons; settings = preferences,
  sources, telegram slots. Curation judges titles + links. HN homepage
  untouched. RSS parsed with an RSS library.
- **[user, pre-authorized]** Newsletter email source only "if not too hard
  right now" — it is not trivial (Email Routing infra), so: **[AI]** deferred
  to backlog with an additive-schema path back in.
- **[AI]** Feed page shows AI-relevant items only (≤20 newest from last
  fetch); empty preferences → latest 20 unfiltered — mirrors the HN feed's
  empty-prefs fallback.
- **[AI]** RSS library: feedsmith (edge-compatible, no `nodejs_compat`
  needed); `@rowanmanning/feed-parser` as fallback if workerd rejects it.
- **[AI]** Per-feed verdict storage lives on `feed_items` directly (feeds are
  single-owner; no join table needed), with `prefVersion` verdict-reuse
  mirroring `curations`.
- **[AI]** Slots: 3 per feed (mirrors telegram), minute-of-day ints,
  interpreted in the user-level `telegram.timezone`; setting slots requires a
  linked chat (409 otherwise), same as the HN digest slots.
- **[AI]** On-demand feed run rate-limited per feed off `lastFetchedAt`
  against `DIGEST_COOLDOWN_SECONDS` (429 + Retry-After); scheduled runs
  exempt.
- **[AI]** Source cap `MAX_FEED_SOURCES = 10` per feed (Workers 50-subrequest
  cap headroom); ≤50 items normalized per source.
- **[AI]** HN AI prompt stays byte-identical; feeds get their own system
  prompt over shared batching/parsing machinery.
- **[AI]** Non-current feed items older than 60 days pruned by the existing
  maintenance tick — only items that were never relevant; relevant items
  are the feed's archive and are kept.
- **[user, round 2]** A feed item is sent to Telegram at most once
  (`feed_items.sentAt` stamp); it may keep appearing in the feed page's top 20. Each feed gets an archive page showing all curations ever for that
  feed.
- **[AI, SA round 1]** RSS responses capped at 5 MB; `feed_sources` unique on
  `(feedId, url)`; AI judges unsaved items via synthetic ids before the
  upsert; cron processes due feeds sequentially (50-subrequest cap) and sends
  the empty-case message; backlog note lives at
  `docs/0-backlog/newsletter-email-sources.md` (no `docs/BACKLOG.md` exists).
