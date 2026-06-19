# Telegram bot

**Branch:** `claude/affectionate-davinci-ksq4cq`
**Status:** proposed

## Original request (verbatim)

> # Telegram bot
>
> Connect to account through some kind of token paste mechanism.
> /set-preferences
> /cur-preferences
> /daily-time # time of day at which it sends you a summary
> /daily-time-2
> /daily-time-3

## Goal

Let the single owner (`just@wallage.nl`) drive the news app from a Telegram bot:
link a Telegram chat to the account with a one-time code, read/write the
preferences blob, and configure up to three daily times at which the bot
re-runs the digest and pushes a fresh summary to the chat.

## Decisions

- **[user] At each daily time, re-run the digest then send.** The bot fetches
  the HN front page fresh, AI-filters against the current preferences, replaces
  the feed (`runDigest`), then sends the newly curated stories. This also keeps
  the website feed fresh.
- **[user] 5-minute precision, fire once per slot per day.** Times are stored
  rounded to the nearest 5 minutes. A heartbeat cron (`*/5 * * * *`) wakes the
  worker, but the **user-visible summary fires exactly once per configured slot
  per day** — at the matching wall-clock minute. The per-wake work when no slot
  matches is a single indexed D1 read and an early return (negligible). At most
  three summaries per day (three slots). _(Interpreted "at most 3 wakeups" as
  "at most 3 summaries/actions"; Cloudflare cron schedules are static config, so
  the cheap heartbeat is the standard way to hit arbitrary 5-minute times. Flag
  this if a different reading was intended.)_
- **[user] Message = titles as links + an app link at the bottom.** Each line is
  the story title as a clickable link (HTML, web-preview disabled), best matches
  first, capped at 15 with an "…and N more" tail. Footer: a link to the app.
  Empty day: a short "nothing matched today" note plus the app link.
- **[AI] Linking = web-generated one-time code pasted into Telegram.** The
  signed-in owner clicks "Connect Telegram" on the preferences page →
  `POST /api/telegram/link-code` mints a short code (15-minute expiry) and shows
  it plus a `https://t.me/<bot>?start=<code>` deep link. Sending `/start <code>`
  to the bot binds that chat's `chatId` to the account. This is the standard
  Telegram deep-link pattern and keeps minting behind Cloudflare Access (only
  the owner can mint).
- **[AI] Webhook lives at `/telegram/webhook`, outside `/api/*`.** It is not
  behind the auth middleware (Telegram cannot present a CF Access identity).
  It is authenticated by the `X-Telegram-Bot-Api-Secret-Token` header compared
  (constant-time) against the `TELEGRAM_WEBHOOK_SECRET` secret; a missing/wrong
  secret fails closed (403). `/telegram/*` is added to wrangler
  `assets.run_worker_first`, and Terraform adds a path-scoped Access application
  on `<host>/telegram/webhook` with a **bypass** policy so Telegram can reach it.
- **[AI] Telegram is a third injected dependency**, alongside `hn` and `ai`.
  `createDeps` wires the real client when `TELEGRAM_BOT_TOKEN` is set
  (production) and a no-op fake otherwise (local + e2e + unit) — same seam
  pattern as the HN/AI fakes, so nothing opens a network connection in tests.
- **[AI] Keep the existing 06:20 web-digest cron untouched.** The two fixed
  crons (`20 4`/`20 5`) still drive the guaranteed daily website refresh via the
  unchanged `runScheduledDigest`. The new `*/5` heartbeat is dispatched
  separately (by `ScheduledController.cron`) to the Telegram delivery path. A
  slot set at ~06:20 may run the digest twice; harmless for a single user.
- **[AI] `/set-preferences` only stores the text** (mirrors `PUT
/api/preferences`); it does not auto-run a digest. The next daily slot (or the
  website Refresh) re-curates.

## Data model

New table `telegram` (Drizzle, one row per user; PK `userEmail`):

| column              | type                | notes                                           |
| ------------------- | ------------------- | ----------------------------------------------- |
| `userEmail`         | text PK             | the account this chat controls                  |
| `chatId`            | integer nullable    | Telegram chat id; null until linked (unique)    |
| `linkCode`          | text nullable       | pending one-time link code; null once consumed  |
| `linkCodeExpiresAt` | integer (timestamp) | nullable; expiry of `linkCode`                  |
| `slot1`             | integer nullable    | daily-summary minute-of-day 0–1439 (mult. of 5) |
| `slot2`             | integer nullable    | second slot                                     |
| `slot3`             | integer nullable    | third slot                                      |

Generated via `pnpm migrate:gen` (new additive migration). A unique index on
`chatId` (webhook looks chats up by it; `linkCode` lookups are rare and tiny).

## Shared contracts (`shared/api.ts`)

```ts
telegramStatusSchema   = { linked: boolean, slots: (string|null)[] }   // "HH:MM"|null, length 3
telegramLinkCodeSchema = { code: string, url: string|null, expiresAt: ISO }
```

`url` is the `t.me` deep link, or `null` when `TELEGRAM_BOT_USERNAME` is unset.

## API (behind auth, under `/api/telegram`)

| method + path                  | result                                           |
| ------------------------------ | ------------------------------------------------ |
| `GET /api/telegram`            | `telegramStatus` for the signed-in user          |
| `POST /api/telegram/link-code` | mints a code (15-min expiry), `telegramLinkCode` |

## Webhook (`POST /telegram/webhook`, not under `/api`)

Validates `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET`
(constant-time; fail closed). Parses the Telegram update (zod). Non-text /
non-slash messages are ignored (200, no reply). Otherwise `handleTelegramUpdate`
resolves the account and returns `{ chatId, reply }`; the route sends the reply
via `deps.telegram.sendMessage` and returns 200.

Commands (chat must be linked except `/start <code>`):

- `/start <code>` — bind this chat to the account that owns the unexpired code;
  clears the code. Invalid/expired → error reply. `/start` alone → greeting.
- `/set-preferences <text>` — upsert the preferences blob; confirm.
- `/cur-preferences` — reply with the current text (or "none set").
- `/daily-time [HH:MM | off]` — no arg shows the current slot; `HH:MM` sets it
  (rounded to 5 min, echoed); `off` clears it. `/daily-time-2`, `/daily-time-3`
  drive `slot2`, `slot3`.
- `/help` and any unknown command — list the commands.
- Unlinked chat (any command but `/start <code>`) — prompt to link first.

## Scheduling

`wrangler` production `triggers.crons = ["20 4 * * *", "20 5 * * *", "*/5 * * * *"]`.
`index.ts` `scheduled` dispatches by `controller.cron`:

- `*/5 * * * *` → `runTelegramDigests(env, scheduledTime)`.
- otherwise → existing `runScheduledDigest(env)` (unchanged 06:20 web digest).

`runTelegramDigests` (in `worker/lib/scheduled.ts`):

1. `minute = amsterdamMinuteOfDay(scheduledTime)` (new helper in `lib/time.ts`,
   uses the scheduled time which is exactly on a 5-minute boundary; Amsterdam's
   whole-hour UTC offset keeps it on a 5-minute boundary locally too).
2. Resolve the owner (first `ALLOWED_EMAILS`). Load the `telegram` row. If not
   linked, or no slot equals `minute`, return.
3. `runDigest(...)` for the owner with `createDeps(env)`, load the current feed,
   format the message, `deps.telegram.sendMessage(chatId, message)`.

The due-slot check and the message formatter are pure functions (unit-tested);
the per-slot bucket occurs once per day so no dedup state is needed.

## Worker structure

- `worker/lib/telegram.ts` — `TelegramClient` seam (`sendMessage`),
  `makeRealTelegramClient(token)` (calls `api.telegram.org`, `parse_mode: HTML`,
  preview disabled), the Telegram `Update` zod schema, and `formatDigestMessage`.
- `worker/lib/telegram-bot.ts` — `handleTelegramUpdate(db, update)`,
  `parseDailyTime`, `formatMinuteOfDay`, link-code generation, due-slot check.
- `worker/lib/feed.ts` — `loadFeed(db, userEmail): Promise<Story[]>` extracted
  from the stories route and reused by the Telegram digest (avoids duplication).
- `worker/routes/telegram.ts` — the `/api/telegram` GET + link-code routes.
- `worker/routes/telegram-webhook.ts` — the `/telegram/webhook` route, mounted
  on `app` outside the `/api/*` auth + deps middleware (builds its own deps).
- `worker/lib/deps.ts` — `Deps` gains `telegram`; `createDeps` wires real iff
  `TELEGRAM_BOT_TOKEN` is set, else `fakeTelegramClient`.
- `worker/lib/fakes.ts` — add `fakeTelegramClient` (no-op send).
- `worker/env.ts` — `Bindings` gains optional `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET` (secrets, not in wrangler vars).

## Config

- `wrangler.jsonc`: `run_worker_first: ["/api/*", "/telegram/*"]`; production
  cron adds `"*/5 * * * *"`; vars add `APP_URL` (local/e2e/prod) and
  `TELEGRAM_BOT_USERNAME` (public, prod). Secrets `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_WEBHOOK_SECRET` are GHA secrets (typed optional); the `deploy-prod`
  job installs them onto the worker with `wrangler secret put` after deploy,
  skipping each when unset so the bot stays optional.
- `iac/main.tf`: path-scoped `cloudflare_zero_trust_access_application` on
  `<custom_domain>/telegram/webhook` with a single **bypass** (everyone) policy,
  gated on `custom_domain_active` like the main app.
- `vitest.workers.config.ts`: add `TELEGRAM_WEBHOOK_SECRET` test binding.
- Bootstrap docs/env: add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_BOT_USERNAME`, and the manual BotFather + `setWebhook` steps.

## UI

`PreferencesPage` gains a "Telegram" section: linked status + the three slot
times (read via `GET /api/telegram`), and a "Connect Telegram" button that calls
`POST /api/telegram/link-code` and reveals the code, the deep link, and the
expiry. Reads via `useCachedFetch`, the write via `apiFetch` (existing patterns).

## Tests

- **Unit (vitest-pool-workers):**
  - `telegram-bot.test.ts` — `parseDailyTime` (rounding, `off`, invalid),
    `formatMinuteOfDay`, and `handleTelegramUpdate` flows against real D1: link
    via `/start <code>`, expired/invalid code, set/cur-preferences, daily-time
    set/show/off, unlinked rejection.
  - `telegram.test.ts` — `formatDigestMessage` (links, HTML escaping, empty,
    footer, 15-cap), and the due-slot check.
  - `time.test.ts` — `amsterdamMinuteOfDay` across DST.
  - `scheduled` Telegram path — sends with a recording fake when a slot matches,
    no-op otherwise.
  - `api.test.ts` — `GET /api/telegram` default + `link-code` mint; webhook
    route links on valid secret, 403 on wrong/missing secret.
- **e2e (Playwright):** `telegram.spec.ts` — the preferences page reveals a
  connect code when the button is clicked (no real bot needed).

## Out of scope

Group chats / multi-user, inline keyboards, editing preferences via buttons,
unlinking from the web UI, and reading the feed inside Telegram beyond the
daily summary.
