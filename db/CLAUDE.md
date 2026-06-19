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
  join table. `current` marks the live feed (older rows are the archive);
  `relevant` is the sticky AI verdict (persisted even when false, so a re-run can
  skip it); `pref_version` is the `preferences.version` the verdict was produced
  against. `current = true` implies `relevant` (see worker/CLAUDE.md for the
  digest's version-skip rule).
- `preferences.version` is a monotonic counter bumped on every real edit (not on
  a no-op resave); the digest stamps it onto each curation as `pref_version`.
- `telegram` is PER-USER (PK `userEmail`, unique `chatId`): the chat link
  (`chatId` + `chatUsername`/`chatName` captured at `/start`), the pending
  one-time `linkCode`/`linkCodeExpiresAt`, and three nullable slot columns
  (daily-summary minute-of-day 0–1439; null = unset).
- Timestamps are epoch integers via `{ mode: "timestamp" }` (surface as `Date`);
  `current`/`relevant` are `{ mode: "boolean" }` integers.
