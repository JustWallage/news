# Rate-limit the Telegram `/fetch` command

## Verbatim request (docs/0-backlog/ratelimit-telegram-fetch.md)

`POST /api/digest/run` (homepage Refresh) is throttled per user by
`DIGEST_COOLDOWN_SECONDS` via `lib/rate-limit.ts` (the `digest_runs` table), but
the Telegram `/fetch` path is NOT. The webhook acks immediately and runs
`sendDailyDigest` in `waitUntil` with no cooldown check, so a single linked user
can spam `/fetch` and trigger unlimited Workers AI passes — the cheapest way to
burn the daily Neuron budget.

Apply the same per-user cooldown to `/fetch`: before kicking off the digest in
the webhook handler, check `digestCooldownRemainingMs()` keyed on the user's
email (resolved from the `chatId` link). When inside the window, reply with a
short "you just refreshed, try again in N min" message instead of running the AI.
Reuse the existing `digest_runs` mechanism so the web Refresh and `/fetch` share
one budget rather than two independent ones.

Add e2e coverage driving the webhook `/fetch` twice in a row and asserting the
second is throttled.

## Current behaviour (verified)

- `worker/lib/rate-limit.ts` exports `digestCooldownRemainingMs(db, email, cooldownMs, now)`
  and `recordDigestRun(db, email, now)` against the `digest_runs` table.
- `worker/routes/digest.ts` (`POST /api/digest/run`) checks the cooldown → 429 +
  `Retry-After`, runs the digest, then `recordDigestRun`.
- `worker/lib/telegram-bot.ts` `handleTelegramUpdate` resolves `/fetch` to a reply
  with `feedFor` set — **no cooldown check**.
- `worker/routes/telegram-webhook.ts` sends the reply, then on `feedFor` runs
  `sendDailyDigest` in `c.executionCtx.waitUntil` — **no cooldown check, never
  records a run**. So `/fetch` is unthrottled and does not consume the shared
  `digest_runs` budget at all.
- `DIGEST_COOLDOWN_SECONDS` is `0` in local/e2e (disables the cooldown so the
  hermetic suite re-runs), `600` in prod.

## Requirements

1. A `/fetch` that lands inside the per-user cooldown window MUST NOT run the
   Workers AI digest. It replies with a short throttle message naming the
   minutes remaining.
2. `/fetch` and `POST /api/digest/run` share ONE budget: an allowed `/fetch`
   records a run in `digest_runs` (same table/keying as the web path), and a web
   Refresh likewise blocks a too-soon `/fetch` and vice-versa.
3. The cron / `sendDueDigests` path stays unthrottled (scheduled delivery is not
   user-triggered abuse).
4. `cooldownMs <= 0` (local/e2e default) keeps `/fetch` fully unthrottled — no
   environment branch in the code; the existing `digestCooldownRemainingMs`
   short-circuit handles it.

## Design decisions

- **Decision point lives in `handleTelegramUpdate`.** The webhook passes
  `cooldownMs = env.DIGEST_COOLDOWN_SECONDS * 1000` and `now` into the resolver.
  For `/fetch`: compute `digestCooldownRemainingMs`; if `> 0`, return the throttle
  reply with **no** `feedFor`; otherwise `recordDigestRun` and return the existing
  "Fetching…" reply with `feedFor`. Env knowledge stays in the route; the decision
  (and thus the throttle message) is pure and directly unit-testable.
- **Record at decision time** (synchronously, before the background `waitUntil`
  digest), mirroring where the check happens and bounding abuse even if the
  background run later fails. The web path records after a successful run; the
  small difference is deliberate and stronger for the Neuron-budget goal.
- **Throttle message:** `⏳ You just refreshed — try again in N min.` where
  `N = Math.ceil(remaining / 60_000)`.
- The webhook keeps acking with `200` regardless (Telegram contract unchanged).

## Tests

The original ask said "e2e", but a Playwright e2e cannot observe throttling:
`DIGEST_COOLDOWN_SECONDS` is `0` in e2e, the throttle reply goes to a fake
Telegram client, and the webhook's `waitUntil` digest is not flushed in tests.
Coverage instead lands where it is observable and runs under `pnpm check`:

1. **`worker/lib/telegram-bot.test.ts` (unit):** drive `/fetch` twice for a linked
   chat with `cooldownMs > 0`. First call returns `feedFor` set and records a run;
   second call returns the throttle reply and `feedFor === undefined`. With
   `cooldownMs = 0`, both calls return `feedFor` (unthrottled).
2. **`worker/routes/api.test.ts` (integration):** drive the real `/telegram/webhook`
   `/fetch` twice with a non-zero `DIGEST_COOLDOWN_SECONDS` env override
   (`app.request(url, init, { ...env, DIGEST_COOLDOWN_SECONDS: 600 })`); assert the
   `digest_runs` row records exactly one run (the second `/fetch` does not advance
   `lastRunAt`).

## Docs

Update `worker/CLAUDE.md`: the note that "the cron and Telegram `/fetch` paths are
NOT rate-limited" — `/fetch` now shares the `digest_runs` cooldown; only cron stays
unthrottled.
