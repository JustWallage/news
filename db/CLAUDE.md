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
  deleted, and `fetchedAt` drives the 60s incremental re-download.
- `curations` is PER-USER (composite PK `userEmail, storyId`), the feed/archive
  join table; `current` marks the live feed, older rows are the archive.
- Timestamps are epoch integers via `{ mode: "timestamp" }` (surface as `Date`);
  `current` is a `{ mode: "boolean" }` integer.
