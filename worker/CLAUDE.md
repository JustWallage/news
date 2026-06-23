# worker/

## Bindings (wrangler.jsonc → `pnpm cf-typegen` → global `Env`)

| Binding                                         | Type    | Notes                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB`                                            | D1      | query via `getDb(c.env)` (Drizzle), never raw `env.DB` in routes                                                                                                                                                                                                                                                                                                             |
| `AI`                                            | Ai      | Workers AI; wired in local + production, NOT e2e — so it is OPTIONAL on `Env`; only `lib/deps.ts` touches it                                                                                                                                                                                                                                                                 |
| `ENVIRONMENT`                                   | var     | `local` / `e2e` / `production`; unknown values fail closed for auth (production); deps are real unless e2e                                                                                                                                                                                                                                                                   |
| `DEV_USER_EMAIL`, `TEST_AUTH_TOKEN`             | secrets | `.dev.vars` locally; per-run secret on e2e workers                                                                                                                                                                                                                                                                                                                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`      | secrets | prod-only; OPTIONAL on `Env` (declared in `env.ts`). The Google OAuth client for the in-app sign-in flow. `makeGoogleAuth` uses the real seam in production (fail-closed 503 if absent), the fake in local/e2e — gated on ENVIRONMENT, NOT presence                                                                                                                          |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`    | secrets | prod-only; OPTIONAL on `Env` (declared in `env.ts`); installed by the deploy workflow like the Telegram creds. Cloudflare Turnstile bot-gate on `/auth/login`. `verifyTurnstile` SKIPS in local/e2e (ENVIRONMENT gate) and is a no-op when the secret is absent (fail OPEN — feature simply off). The site key (public) is served to the SPA by `GET /auth/config`           |
| `DIGEST_COOLDOWN_SECONDS`                       | var     | committed (0 local/e2e, 600 prod); widened to `number` in `env.ts`. Per-user cooldown on `POST /api/digest/run` (0 disables it, so the hermetic suite can run repeatedly)                                                                                                                                                                                                    |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | secrets | prod-only; OPTIONAL on `Env` (declared in `env.ts`). Token presence flips `createDeps` to the real Telegram client; the webhook secret gates `/telegram/webhook` (fail closed). The e2e env sets a FIXED `TELEGRAM_WEBHOOK_SECRET` var (`e2e-webhook-secret`) so the hermetic suite can drive the webhook (link/disconnect) — telegram stays the no-op fake there (no token) |
| `APP_URL`, `TELEGRAM_BOT_USERNAME`              | vars    | summary footer link; bot `@username` (no `@`) for `t.me` deep links — empty → link-code `url` is null. `TELEGRAM_BOT_USERNAME` is widened to `string` in `env.ts` (committed `""`, real in prod)                                                                                                                                                                             |

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

## Security headers & CSRF (`index.ts`, `middleware/csrf.ts`, `public/_headers`)

- `index.ts` mounts `hono/secureHeaders` (HSTS, `X-Frame-Options: DENY`, nosniff,
  referrer policy, a lean `default-src 'none'` CSP) on EVERY worker response. The
  SPA document + static assets are served by the assets handler (they never hit
  the worker), so THEIR full CSP/frame-ancestors live in **`public/_headers`**
  (which allows `challenges.cloudflare.com` for the Turnstile widget). Edit the
  CSP there, not here, when the frontend gains an external origin.
- `middleware/csrf.ts` `originGuard` runs on every request: for non-safe methods
  it 403s when the `Origin` header is present AND differs from the worker's own
  origin. A MISSING Origin is allowed (same-origin/non-browser), so the Telegram
  webhook and the unit/e2e harness are unaffected. Defence-in-depth atop the
  SameSite=Lax session cookie.

## Auth (`middleware/auth.ts`, `routes/auth.ts`, `lib/session.ts`, `lib/oauth.ts`, `lib/turnstile.ts`)

- Auth is in the Worker — there is NO Cloudflare Access. `routes/auth.ts` mounts
  `/auth/{config,login,callback,logout}` **outside `/api`** (you must reach them
  without a session) — `/auth/*` is in `assets.run_worker_first`. Login uses
  `arctic` to run Google OAuth (state + PKCE verifier in short-lived signed
  cookies); the callback requires `email_verified` (and 400s on a token-exchange
  failure rather than 500ing), then `createSession` mints an opaque token whose
  SHA-256 hash is the `sessions` row id and sets it as the `session` cookie.
- `/auth/login` is bot-gated by Cloudflare Turnstile (`lib/turnstile.ts`): the
  widget posts its token as the `cf-turnstile-response` query param, verified via
  siteverify. Skipped in local/e2e (ENVIRONMENT gate, like the OAuth fake) and a
  no-op when unconfigured. `GET /auth/config` tells the SPA whether to render the
  widget (`turnstileSiteKey` null → plain sign-in button).
- `middleware/auth.ts` is THE only identity resolver: production reads the
  `session` cookie → `lookupSession`; e2e uses `X-Test-User-Email` + `X-Test-Auth`;
  local uses `DEV_USER_EMAIL`. Unknown ENVIRONMENT fails closed like production.
- `lib/oauth.ts` `makeGoogleAuth(env, redirectUri)` returns the fake seam ONLY in
  local/e2e and the real arctic client otherwise (`null` → route 503 when secrets
  absent). Gating on ENVIRONMENT, not secret presence, is deliberate: the fake
  returns a verified owner, so it must never be reachable in production.

## Telegram (`lib/telegram*.ts`, `routes/telegram*.ts`)

- The webhook `POST /telegram/webhook` lives **outside `/api`** (like `/auth/*`):
  Telegram cannot present a session, so it skips the auth + deps middleware and
  builds its own deps. It is gated solely by `X-Telegram-Bot-Api-Secret-Token` vs
  `TELEGRAM_WEBHOOK_SECRET` (constant-time, fail closed). `/telegram/*` is in
  `assets.run_worker_first`.
- `handleTelegramUpdate(db, update)` is pure w.r.t. Telegram: it applies side
  effects and returns `{ chatId, reply }`; the route sends the reply. The chat
  is resolved by `chatId`; linking consumes a one-time `linkCode` minted by
  `POST /api/telegram/link-code` (15-min expiry) and captures the chat
  username/name for `chatLabel` (Telegram does not expose phone numbers to bots).
  `POST /api/telegram/test` sends a test message via `c.var.deps.telegram`.
  `/fetch` acks immediately, then the webhook runs `sendDailyDigest` in
  `c.executionCtx.waitUntil` (the digest takes seconds — don't block the ack).
  `/disconnect` (bot) and `DELETE /api/telegram` (web) both call
  `disconnectTelegram` → delete the user's row (chat link, pending code, slots),
  so the account is back to unlinked; idempotent.
  The command list is `worker/lib/bot-commands.json` (single source of truth):
  the bot derives its `HELP`/`/help` reply from it, and the deploy workflow
  `setMyCommands`-registers the same file for client autocomplete. Telegram
  rejects hyphens in registered command names, so they use underscores.
- Slot times are minute-of-day rounded to 5 (`parseDailyTime`). They are set
  either from the bot (`/daily_time*`) or the web UI (`PUT /api/telegram/slots`,
  body `telegramSlotsUpdateSchema`, 409 until linked → `saveSlots`).
- Slots are interpreted in the user's `telegram.timezone` (IANA; null →
  Europe/Amsterdam). The timezone is captured from the browser on
  `POST /link-code` and editable via `PUT /api/telegram/timezone`
  (`saveTimezone` upsert) — both bodies validated by `telegramTimezoneSchema`.
  `minuteOfDayInTz` (`lib/time.ts`) is the zone-aware conversion the `*/5`
  due-check uses.

## Data model & invariants

- `stories` is a GLOBAL, persistent content cache keyed by HN id. `curations`
  is PER-USER (`PK (userEmail, storyId)`): the AI verdict for a story plus
  whether it is in that user's CURRENT feed. `current` = live-feed membership,
  recomputed every run; `relevant` = the sticky verdict; `pref_version` = the
  `preferences.version` the verdict was produced against. `current = true` iff
  the story is in the latest front page AND `relevant`.
- Preference VERSIONING drives an incremental digest: `PUT /api/preferences`
  bumps `preferences.version` only on a real text change (a no-op resave does
  not). `lib/digest.ts` splits the work in two so the cron can share one fetch
  across users: `fetchFrontPage(db, hn, now)` resolves candidates — if the latest
  `stories.fetchedAt` is < 5 min before `now` (`RATE_LIMIT_MS`), REUSE the cached
  snapshot (the rows sharing that max `fetchedAt`) and skip the HN fetch + upsert;
  otherwise fetch the whole front page in ONE request (`hn.frontPage()` → Algolia)
  and upsert all into `stories`. `curateForUser(db, ai, candidates, prefsText,
prefVersion, userEmail, now)` then, per user, reuses curations
  already judged at `prefVersion` and AI-filter ONLY the candidates not yet
  judged at it → set `current=false` for the user, then upsert EVERY evaluated
  candidate (relevant and not) with `pref_version=prefVersion` and
  `current=relevant` (preserving `openedAt`). Re-evaluation is scoped to the
  current front page; older off-front-page curations are never re-evaluated.
  Empty prefs → AI-free top-30-by-score fallback, always recomputed (no skip).
  `loadPreferences` returns `{ text, version }`; `count` = relevant candidates.
  Story rows are never deleted. `runDigest` = `fetchFrontPage` then
  `curateForUser` (the single-user path used by the route + Telegram `/fetch`).
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
  routes never read auth headers/cookies.
- `POST /api/digest/run` (homepage Refresh + e2e) runs the digest for the current
  user via `c.var.deps` — no environment gate. It IS rate-limited per user via
  `lib/rate-limit.ts` (the `digest_runs` table) by `DIGEST_COOLDOWN_SECONDS`
  (0 = off in local/e2e); a request inside the window 429s with `Retry-After` and
  does NOT run the AI. The cron and Telegram `/fetch` paths are NOT rate-limited.
- `index.ts` `scheduled` has ONE cron, `*/5 * * * *` → `runTelegramDigests` →
  `sendDueDigests`: load the `telegram` rows whose `chatId` is set and at least
  one slot is configured, then keep those whose slot matches the current minute
  IN THAT ROW'S timezone (`minuteOfDayInTz`, null → Europe/Amsterdam) — the due
  check is per-row in JS, not a single SQL minute filter. If none are due, return
  WITHOUT touching HN; otherwise `fetchFrontPage` ONCE and `curateForUser` + send
  to every due user in parallel (`Promise.all`). A linked chat with a configured
  slot is the only opt-in to a scheduled digest; there is no longer a separate
  web-digest cron. The same `*/5` handler also runs `runScheduledMaintenance`
  (`lib/maintenance.ts`) — on the 03:00 UTC tick only — to purge expired sessions
  and clear expired link codes (telegram rows survive; only the stale code fields
  are cleared).
- Logs never write the user email (PII): `lib/digest.ts` logs a short
  `user#<hash>` tag (`sha256Hex` prefix) instead.
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
