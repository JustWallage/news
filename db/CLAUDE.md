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
  re-fetched (Algolia, one request) and upserted on each digest run.
- `curations` is PER-USER (composite PK `userEmail, storyId`), the feed/archive
  join table; `current` marks the live feed, older rows are the archive.
- `telegram` is PER-USER (PK `userEmail`, unique `chatId`): the chat link
  (`chatId` + `chatUsername`/`chatName` captured at `/start`), the pending
  one-time `linkCode`/`linkCodeExpiresAt`, and three nullable slot columns
  (daily-summary minute-of-day 0–1439; null = unset).
- Timestamps are epoch integers via `{ mode: "timestamp" }` (surface as `Date`);
  `current` is a `{ mode: "boolean" }` integer.
