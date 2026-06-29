# Rate-limit the Telegram `/fetch` command

`POST /api/digest/run` (homepage Refresh) is throttled per user by
`DIGEST_COOLDOWN_SECONDS` via `lib/rate-limit.ts` (the `digest_runs` table), but
the Telegram `/fetch` path is NOT. The webhook acks immediately and runs
`sendDailyDigest` in `waitUntil` with no cooldown check, so a single linked user
can spam `/fetch` and trigger unlimited Workers AI passes — the cheapest way to
burn the daily Neuron budget.

Apply the same per-user cooldown to `/fetch`: before kicking off the digest in
the webhook handler, check `digestCooldownRemainingMs()` keyed on the user's
email (resolved from the `chatId` link). When inside the window, send the user's
last curations as-is instead of running the AI again.
Reuse the existing `digest_runs` mechanism so the web Refresh and `/fetch` share
one budget rather than two independent ones.

Add e2e coverage driving the webhook `/fetch` twice in a row and asserting the
second is throttled.
