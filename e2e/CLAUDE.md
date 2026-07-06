# e2e/

`pnpm test:e2e` — single command; Playwright auto-starts an e2e-mode dev server
on port 5174 (`pnpm dev:e2e`, separate from `pnpm dev` on 5173) and reuses it
across runs. In CI, `BASE_URL` points at the ephemeral worker and no server
starts.

Isolation & parallelism:

- Each test runs as a UNIQUE random user (`fixtures.ts` generates the email and
  overrides `extraHTTPHeaders` per test). The feed (`curations`) and preferences
  are per-user, so tests are fully isolated → `fullyParallel: true`, no DB reset.
  The global `stories` cache is shared and insert-only, exactly like production.
- The e2e auth path (`ENVIRONMENT=e2e`) accepts ANY email via the
  `X-Test-User-Email` + `X-Test-Auth` headers; the token defaults to
  `local-test-token` locally, per-run in CI.

Notes:

- Import `test`/`expect` from `./fixtures`, never `@playwright/test` directly.
- Seed a feed by setting preferences then triggering a digest — either click the
  **Refresh** button or `POST /api/digest/run`. The fake AI selects a canned
  story when its title contains a word from the prefs text, so prefs steer the
  feed (e.g. prefs "rust" → only the Rust story).
- The fake HN front page serves ~100 stories (`worker/lib/fakes.ts`) so the
  chunked D1 upserts (100-bound-param limit, see worker/CLAUDE.md) are
  exercised against real D1 in the pipeline's ephemeral-e2e stage.
- `pnpm dev:e2e` creates `.dev.vars` from `.dev.vars.example` when missing
  (it holds the `TEST_AUTH_TOKEN` the e2e auth path checks — without it every
  test fails on the unauthenticated landing page).
- If you change the schema, delete `.wrangler/` so the local e2e D1 re-migrates;
  a stale local DB surfaces as `/api/*` 500s.
