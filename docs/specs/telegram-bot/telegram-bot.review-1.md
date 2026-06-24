# Spec Review: Telegram bot

## Summary

The implementation is a faithful, high-quality realization of the spec. Every
spec requirement — the `telegram` table and additive migration, the two shared
schemas, the auth-gated `GET /api/telegram` + `POST /api/telegram/link-code`
routes, the secret-gated `/telegram/webhook` outside `/api`, all six bot
commands, the `*/5` heartbeat dispatched by `controller.cron` to
`runTelegramDigests`, the message formatter, the injected Telegram dependency,
the wrangler/Terraform/bootstrap config, the UI section, and the unit + e2e
tests — is present and matches the surrounding repo conventions (no `as` casts,
boundary types from `shared/`/Drizzle, schema-parsed responses, no-op fake seam,
minimal inline comments). The code is simple and readable. The only gaps are two
small test-coverage omissions that the spec explicitly calls out and one tiny
piece of unreachable defensive code; none are correctness bugs.

## Findings

### Simplicity

- `worker/lib/telegram-bot.ts:188` — `SLOT_SETTERS[index]?.(value) ?? {}` carries
  an unreachable fallback. `index` is only ever 0/1/2 (the three literal call
  sites in `handleTelegramUpdate`), so the optional-chain miss and the `?? {}`
  (which would issue a no-op `UPDATE ... SET {}`) can never fire — they exist
  only to satisfy `noUncheckedIndexedAccess`. This is acceptable as-is, but a
  3-branch `switch (index)` or a direct object literal keyed by column name would
  be clearer and remove the dead path. Minor; not blocking.
- Otherwise the approach is the simplest correct one: `loadFeed` extraction
  (`worker/lib/feed.ts`) removes real duplication, `dueSlot`/`parseDailyTime`/
  `formatMinuteOfDay` are small pure functions, and the heartbeat does a single
  indexed read then early-returns. No over-engineering.

### Spec implementation

- Clean. All routes, commands, scheduling, data model, config, and UI match the
  spec. Verified specifically: `/start` alone → greeting; expired/invalid code →
  error (`telegram-bot.ts:125-130`); `/daily-time` no-arg shows current, `HH:MM`
  sets rounded + echoed, `off` clears (`setSlot`); unlinked chats are rejected
  for every command except `/start` (`telegram-bot.ts:219-222`); webhook fails
  closed on missing/empty/wrong secret (`telegram-webhook.ts:25-32`); `url` is
  null when `TELEGRAM_BOT_USERNAME` is unset (`telegram.ts:26`); 15-min expiry,
  unique `chatId` index, additive migration `0001`, `run_worker_first` includes
  `/telegram/*`, prod cron adds `*/5 * * * *`, Terraform bypass app on
  `/telegram/webhook`. No invented behavior beyond the spec.

### No shortcuts

- No hacks, swallowed errors that matter, stubs, or TODOs. `parseJsonBody`
  swallowing a JSON parse error (`telegram-webhook.ts:11-17`) is correct: an
  unparseable body is acknowledged with 200 so Telegram stops retrying, matching
  the spec's "acknowledge anything we can't parse." `makeRealTelegramClient`
  logs (not throws) on a non-OK Bot API response (`telegram.ts:26-28`), which is
  the right call for a fire-and-forget cron/webhook send.
- `timingSafeEqual` reuse (`worker/lib/crypto.ts`) is the real constant-time
  comparison via SHA-256 digests, not a shortcut.

### Code quality

- Clear and consistent. Naming, comment density, schema-parse-at-the-boundary,
  and the dependency-injection seam all match the existing codebase. The
  per-package CLAUDE.md files were updated in the same change (db, shared, src,
  worker, iac), satisfying the repo's docs-in-same-commit rule.
- `worker/lib/scheduled.test.ts:63` — the test file only covers the
  `sendDailyDigest` happy path. The spec's Tests section asks the scheduled
  Telegram path to assert "no-op otherwise" (off-slot wake sends nothing). That
  branch (`runTelegramDigests` early-return when `!dueSlot`) is currently
  unexercised. Add a test that inserts a linked row with a non-matching slot and
  asserts the recording client received zero messages.
- `worker/routes/api.test.ts:124-129` — the webhook test covers the wrong-secret
  403 but not the missing-header case. The spec says "403 on wrong/missing
  secret"; the `given === undefined` branch in `telegram-webhook.ts:28` is
  untested. Add a request with no `X-Telegram-Bot-Api-Secret-Token` header
  asserting 403 (the `webhook(null, …)` helper already supports this).

## Action list (prioritized)

1. Add a `runTelegramDigests` off-slot no-op test (`worker/lib/scheduled.test.ts`):
   linked row, slot that does not match the wake minute → recording client gets
   zero sends. Spec-required coverage for the heartbeat early-return.
2. Add a missing-secret 403 case to the webhook test (`worker/routes/api.test.ts`,
   reuse `webhook(null, update)`). Spec says "wrong/missing secret."
3. Optional cleanup: replace `SLOT_SETTERS[index]?.(value) ?? {}`
   (`worker/lib/telegram-bot.ts:188`) with a `switch (index)` or a column-keyed
   literal to drop the unreachable `?? {}` no-op-update branch.

VERDICT: CHANGES_REQUESTED
