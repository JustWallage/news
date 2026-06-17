# worker/

## Bindings (wrangler.jsonc → `pnpm cf-typegen` → global `Env`)

| Binding                             | Type    | Notes                                                                                                                                 |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DB`                                | D1      | query via `getDb(c.env)` (Drizzle), never raw `env.DB` in routes                                                                      |
| `AI`                                | Ai      | Workers AI; wired ONLY in the production env, so it is OPTIONAL on `Env` — only `lib/deps.ts` touches it                              |
| `ENVIRONMENT`                       | var     | `local` / `e2e` / `production`; ANY other value must behave like production for auth (fail closed) and like non-prod for deps (fakes) |
| `ALLOWED_EMAILS`                    | var     | comma list; the first entry is the cron's digest owner                                                                                |
| `DEV_USER_EMAIL`, `TEST_AUTH_TOKEN` | secrets | `.dev.vars` locally; per-run secret on e2e workers                                                                                    |

## Dependency injection (the ONLY env branch)

`lib/deps.ts` `createDeps(env)` returns `{ hn, ai }` — real (`realHnClient` +
`makeRealAiFilter(env.AI)`) in production, deterministic fakes (`lib/fakes.ts`)
everywhere else. `index.ts` sets `c.var.deps` for every `/api/*` request; the
cron calls `createDeps` directly. Every handler and `runDigest` are
environment-agnostic — no `ENVIRONMENT`/`isTest` checks leak into logic, and
there is no test-only route surface.

## Data model & invariants

- `stories` is a GLOBAL, persistent content cache keyed by HN id. `curations`
  is PER-USER (`PK (userEmail, storyId)`): which cached stories were selected
  for a user and whether they are in that user's CURRENT feed (`current` flag).
- `runDigest(db, deps, prefs, userEmail, now)` (`lib/digest.ts`): fetch the
  whole front page in ONE request (`hn.frontPage()` → Algolia) → upsert all into
  `stories` → AI-filter the candidate set → set `current=false` for the user,
  then upsert the selected as `current=true` (preserving `openedAt`). Older
  curations stay as the user's archive; story rows are never deleted.
- Two platform limits shape the writes: Workers Free caps **subrequests at 50**
  (hence one front-page request, not 1+N item fetches), and D1 caps a query at
  **100 bound parameters** — so the multi-row upserts are CHUNKED
  (`STORY_CHUNK`/`CURATION_CHUNK` = 10 rows; 10×8 < 100). A single giant insert
  passes miniflare locally but fails on real D1; don't switch back.
- Feed = `curations` joined to `stories` where `userEmail = me AND current`.
  Identity comes ONLY from `c.get("userEmail")` (set by `middleware/auth.ts`);
  routes never read auth headers.
- `POST /api/digest/run` (homepage Refresh + cron + e2e) runs the digest for the
  current user via `c.var.deps` — no environment gate.
- Responses are built through `shared/api.ts` schema `.parse(...)` in
  `lib/serialize.ts` (the no-casts pattern).

## Tests

vitest-pool-workers runs these in real workerd with ONE D1 per test FILE (not
per test) — `beforeEach` clears the shared tables. Migrations are applied by
`test-setup.ts` via the `TEST_MIGRATIONS` binding from
`vitest.workers.config.ts`. Call routes as
`app.request(path, init, { ...env, ENVIRONMENT: "local" })` (named `app` export);
`ENVIRONMENT=local` makes `createDeps` return the fakes.
