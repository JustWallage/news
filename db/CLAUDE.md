# db/

Drizzle schema + generated SQL migrations (applied by wrangler, NOT drizzle-kit).

Workflow for any schema change:

1. Edit `schema.ts`.
2. `pnpm migrate:gen` — drizzle-kit writes a new SQL file to `migrations/`.
3. Review the SQL, then `pnpm migrate:local`.
4. CI applies it remotely (`--remote --env e2e|production`) before deploys.

Rules:

- NEVER edit or delete an already-committed migration file; add a new one.
  Migrations must be additive (expand/contract) — prod applies them in order.
  (Pre-deploy, the single `0000` was regenerated freely; once shipped, append.)
- The `meta/` folder is drizzle-kit's snapshot state — commit it, never edit it.
- `stories` is a GLOBAL content cache keyed by the HN item id; rows are never
  deleted. `fetchedAt` records the last refresh — the whole front page is
  re-fetched (Algolia, one request) and upserted on each digest run, UNLESS the
  latest `fetchedAt` is < 5 min old, in which case the run reuses that cached
  snapshot instead of fetching (see worker/CLAUDE.md `RATE_LIMIT_MS`).
- `curations` is PER-USER (composite PK `userEmail, storyId`), the feed/archive
  join table. `current` marks the live feed; `relevant` is the sticky AI verdict
  (persisted even when false, so a re-run can skip it); `pref_version` is the
  `preferences.version` the verdict was produced against. `current = true`
  implies `relevant` (see worker/CLAUDE.md for the digest's version-skip rule).
  `last_shown_at` = the last run in which the story was in that user's feed, and
  it is THE archive column: non-null = ever shown, and it is the sort key
  (newest first). It only ever moves forward — a story re-judged irrelevant
  keeps its stamp, and a curated-but-never-relevant story never gets one, so
  those never reach the archive. `opened_at` is the read stamp (first open only).
- `preferences.version` is a monotonic counter bumped on every real edit (not on
  a no-op resave); the digest stamps it onto each curation as `pref_version`.
- `telegram` is PER-USER (PK `userEmail`, unique `chatId`): the chat link
  (`chatId` + `chatUsername`/`chatName` captured at `/start`), the pending
  one-time `linkCode`/`linkCodeExpiresAt`, and three nullable slot columns
  (daily-summary minute-of-day 0–1439; null = unset).
- `sessions` (PK = SHA-256 of the cookie token) and `digest_runs` (PK
  `userEmail`, `lastRunAt`) are auth/rate-limit state. `digest_runs` backs the
  per-user cooldown on `POST /api/digest/run`. Expired sessions + link codes are
  purged nightly by the cron (`worker/lib/maintenance.ts`).
- `feeds`/`feed_sources`/`feed_items` are the user-feeds system (RSS sources +
  per-feed AI curation), PER-USER via `feeds.user_email`. `feed_items` carries
  the verdict inline (no join table — feeds are single-owner): `relevant`/
  `pref_version` mirror `curations`' sticky-verdict reuse against
  `feeds.pref_version` (bumped only on a real `preferences_text` change),
  `current` = member of the latest fetch AND relevant, unique `(feed_id, link)`
  dedupes across fetches and sources. `sent_at` is the send-once Telegram guard:
  stamped when the item is delivered, never re-sent, preserved by the upsert.
  `feed_items.opened_at` is the read stamp (the twin of `curations.opened_at`):
  set on the user's FIRST open, never cleared, also preserved by the upsert.
  **`current` does NOT gate delivery** — the Telegram queue is
  `relevant AND sent_at IS NULL` (see worker/CLAUDE.md); `current` is the web
  feed's live-membership flag alone.
- `feed_items.source_id` is which source yielded the link (first one wins the
  dedupe), nullable and deliberately NOT a foreign key: removing a source must
  neither fail nor delete its already-judged items. Rows written before
  attribution stay null and belong to no source's counts.
  `feed_items.description` is the optional plain-text excerpt the relevance pass
  reads alongside the title (null when the source publishes none).
  Relevant items are the feed's archive and are never pruned; never-relevant
  non-current ones age out after 60 days (`worker/lib/maintenance.ts`).
  `feeds.last_fetched_at` doubles as the per-feed cooldown stamp for
  `POST /api/feeds/:id/run`; `feeds.slot1-3` are minute-of-day like `telegram`'s
  and are interpreted in the owner's `telegram.timezone`.
- Timestamps are epoch integers via `{ mode: "timestamp" }` (surface as `Date`);
  `current`/`relevant` are `{ mode: "boolean" }` integers.
