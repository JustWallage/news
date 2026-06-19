# worker/

## Bindings (wrangler.jsonc → `pnpm cf-typegen` → global `Env`)

| Binding                                         | Type    | Notes                                                                                                                                                                                            |
| ----------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DB`                                            | D1      | query via `getDb(c.env)` (Drizzle), never raw `env.DB` in routes                                                                                                                                 |
| `AI`                                            | Ai      | Workers AI; wired in local + production, NOT e2e — so it is OPTIONAL on `Env`; only `lib/deps.ts` touches it                                                                                     |
| `ENVIRONMENT`                                   | var     | `local` / `e2e` / `production`; unknown values fail closed for auth (production); deps are real unless e2e                                                                                       |
| `ALLOWED_EMAILS`                                | var     | comma list; the first entry is the cron's digest owner                                                                                                                                           |
| `DEV_USER_EMAIL`, `TEST_AUTH_TOKEN`             | secrets | `.dev.vars` locally; per-run secret on e2e workers                                                                                                                                               |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | secrets | prod-only; OPTIONAL on `Env` (declared in `env.ts`). Token presence flips `createDeps` to the real Telegram client; the webhook secret gates `/telegram/webhook` (fail closed)                   |
| `APP_URL`, `TELEGRAM_BOT_USERNAME`              | vars    | summary footer link; bot `@username` (no `@`) for `t.me` deep links — empty → link-code `url` is null. `TELEGRAM_BOT_USERNAME` is widened to `string` in `env.ts` (committed `""`, real in prod) |

## Dependency injection (the ONLY env branch)

`lib/deps.ts` `createDeps(env)` returns `{ hn, ai, telegram }` — deterministic
fakes (`lib/fakes.ts`) for e2e (or any env without the AI binding), real
(`realHnClient` + `makeRealAiFilter(env.AI)`) otherwise. **Telegram is wired
independently of hn/ai**: real iff `TELEGRAM_BOT_TOKEN` is set, else the no-op
`fakeTelegramClient`. So **local + production hit real Hacker News + Workers AI**
(`pnpm dev`/`wrangler dev` exercises the real pipeline) and **e2e is hermetic**.
`index.ts` sets `c.var.deps` for every `/api/*` request; the cron + webhook call
`createDeps` directly. Every handler and `runDigest` are environment-agnostic —
no `ENVIRONMENT`/`isTest` checks leak into logic, and there is no test-only route.

## Telegram (`lib/telegram*.ts`, `routes/telegram*.ts`)

- The webhook `POST /telegram/webhook` lives **outside `/api`** — Telegram has no
  CF Access identity, so it skips the auth + deps middleware and builds its own
  deps. It is gated solely by `X-Telegram-Bot-Api-Secret-Token` vs
  `TELEGRAM_WEBHOOK_SECRET` (constant-time, fail closed). `/telegram/*` is in
  `assets.run_worker_first`, and Terraform bypasses CF Access for that path.
- `handleTelegramUpdate(db, update)` is pure w.r.t. Telegram: it applies side
  effects and returns `{ chatId, reply }`; the route sends the reply. The chat
  is resolved by `chatId`; linking consumes a one-time `linkCode` minted by
  `POST /api/telegram/link-code` (15-min expiry) and captures the chat
  username/name for `chatLabel` (Telegram does not expose phone numbers to bots).
  `POST /api/telegram/test` sends a test message via `c.var.deps.telegram`.
  `/fetch-feed` acks immediately, then the webhook runs `sendDailyDigest` in
  `c.executionCtx.waitUntil` (the digest takes seconds — don't block the ack).
- Slot times are minute-of-day rounded to 5 (`parseDailyTime`).

## Data model & invariants

- `stories` is a GLOBAL, persistent content cache keyed by HN id. `curations`
  is PER-USER (`PK (userEmail, storyId)`): the AI verdict for a story plus
  whether it is in that user's CURRENT feed. `current` = live-feed membership,
  recomputed every run; `relevant` = the sticky verdict; `pref_version` = the
  `preferences.version` the verdict was produced against. `current = true` iff
  the story is in the latest front page AND `relevant`.
- Preference VERSIONING drives an incremental digest: `PUT /api/preferences`
  bumps `preferences.version` only on a real text change (a no-op resave does
  not). `runDigest(db, deps, prefsText, prefVersion, userEmail, now)`
  (`lib/digest.ts`): resolve candidates — if the latest `stories.fetchedAt` is
  < 5 min before `now` (`RATE_LIMIT_MS`), REUSE the cached snapshot (the rows
  sharing that max `fetchedAt`) and skip the HN fetch + upsert; otherwise fetch
  the whole front page in ONE request (`hn.frontPage()` → Algolia) and upsert all
  into `stories` → reuse curations
  already judged at `prefVersion` and AI-filter ONLY the candidates not yet
  judged at it → set `current=false` for the user, then upsert EVERY evaluated
  candidate (relevant and not) with `pref_version=prefVersion` and
  `current=relevant` (preserving `openedAt`). Re-evaluation is scoped to the
  current front page; older off-front-page curations are never re-evaluated.
  Empty prefs → AI-free top-30-by-score fallback, always recomputed (no skip).
  `loadPreferences` returns `{ text, version }`; `count` = relevant candidates.
  Story rows are never deleted.
- `lib/ai.ts`: Workers AI returns this model's output OpenAI-style
  (`choices[0].message.content`, a JSON string), NOT `{response}` — `parseVerdicts`
  handles both. Set `max_tokens` (default ~256 truncates a batch → `finish_reason:
"length"` → unparseable JSON); batches run concurrently and are kept small so
  each response fits. `worker/lib/ai.test.ts` pins these shapes.
- Two platform limits shape the writes: Workers Free caps **subrequests at 50**
  (hence one front-page request, not 1+N item fetches), and D1 caps a query at
  **100 bound parameters** — so the multi-row upserts are CHUNKED
  (`STORY_CHUNK`/`CURATION_CHUNK` = 10 rows; curations now bind 9 cols → 90 < 100).
  A single giant insert passes miniflare locally but fails on real D1; don't
  switch back.
- Feed = `curations` joined to `stories` where `userEmail = me AND current`.
  Identity comes ONLY from `c.get("userEmail")` (set by `middleware/auth.ts`);
  routes never read auth headers.
- `POST /api/digest/run` (homepage Refresh + cron + e2e) runs the digest for the
  current user via `c.var.deps` — no environment gate.
- `index.ts` `scheduled` dispatches by `controller.cron`: `*/5 * * * *` →
  `runTelegramDigests` (sends a summary only when the Amsterdam minute matches a
  configured slot — each slot fires once/day; off-slot wakes early-return after
  one indexed read); the fixed `20 4`/`20 5` fires → the unchanged 06:20
  `runScheduledDigest` web digest.
- Responses are built through `shared/api.ts` schema `.parse(...)` in
  `lib/serialize.ts` (the no-casts pattern).

## Tests

vitest-pool-workers runs these in real workerd with ONE D1 per test FILE (not
per test) — `beforeEach` clears the shared tables. Migrations are applied by
`test-setup.ts` via the `TEST_MIGRATIONS` binding. The pool loads the **e2e
wrangler env** (`environment: "e2e"` in `vitest.workers.config.ts`) so there is
NO AI binding — CI has no Cloudflare creds, and this keeps the pool from opening
a remote Workers AI connection. Route tests therefore use the e2e identity
(`X-Test-User-Email` + `X-Test-Auth` headers; `createDeps` returns fakes for
e2e); the auth middleware tests pass explicit env objects (named `app` export).
