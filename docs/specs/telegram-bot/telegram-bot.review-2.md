# Spec Review: Telegram bot (cycle 2)

## Summary

The implementation remains a faithful, high-quality realization of the spec, and
all three changes requested in review-1 are genuinely resolved. The `*/5`
heartbeat now has an off-slot no-op test, the webhook test now asserts 403 on a
missing secret header, and the index-keyed `SLOT_SETTERS` array with its
unreachable `?? {}` fallback has been replaced by the total `slotValue`/
`slotPatch` helpers. Every spec requirement is present — the `telegram` table +
additive migration, the two shared schemas, the auth-gated `GET /api/telegram` +
`POST /api/telegram/link-code` routes, the secret-gated `/telegram/webhook`
outside `/api`, all bot commands, the heartbeat dispatched by `controller.cron`,
the message formatter, the injected Telegram dependency, the wrangler/Terraform/
bootstrap config, the UI section, and the unit + e2e tests — and it matches repo
conventions (no `as` casts, boundary types from `shared/`/Drizzle, schema-parsed
responses, the no-op fake seam, minimal inline comments, per-package CLAUDE.md
updated in the same change). No blocking issues remain.

## Verification of prior findings

1. **Off-slot no-op test — resolved.** `worker/lib/scheduled.test.ts:95-110`
   inserts a linked row whose `slot1` is `minute + 5`, calls `runTelegramDigests`,
   and asserts `stories` stays empty (the digest never ran), then flips the slot
   to `minute` and asserts stories appear. This exercises the `!dueSlot`
   early-return. The `chatId == null` early-return is separately covered at
   `:112-119`.
2. **Missing-secret 403 — resolved.** `worker/routes/api.test.ts:131-136` sends
   the webhook request with `webhook(null, update)` (no
   `X-Telegram-Bot-Api-Secret-Token` header) and asserts status 403, alongside
   the existing wrong-secret case. This covers the `given === undefined` branch
   in `telegram-webhook.ts:28`.
3. **`SLOT_SETTERS` cleanup — resolved.** `worker/lib/telegram-bot.ts:161-171`
   now uses total functions `slotValue(row, index)` and `slotPatch(index, value)`
   over the literal indices 0/1/2; there is no optional-chain miss and no
   no-op-`UPDATE` fallback. `setSlot` (`:173-199`) reads via `slotValue` and
   writes via `slotPatch`.

## Findings

### Simplicity

- Clean. `loadFeed` (`worker/lib/feed.ts`) removes real duplication with the
  stories route; `parseDailyTime`, `formatMinuteOfDay`, and `dueSlot` are small
  pure functions; the heartbeat does one indexed read then early-returns. The
  `slotValue`/`slotPatch` ternaries are the simplest total form for three fixed
  columns. No over-engineering.

### Spec implementation

- Clean. All routes, commands, scheduling, data model, config, and UI match the
  spec. Verified: `/start` alone → greeting (`telegram-bot.ts:116-117`);
  expired/invalid code → error (`:125-130`); single-use code cleared on link
  (`:131-134`); `/daily-time` no-arg shows current, `HH:MM` rounds + echoes,
  `off`/`clear` clears (`setSlot` + `parseDailyTime`); unlinked chats rejected
  for every command except `/start` (`:225-228`); webhook fails closed on
  missing/empty/wrong secret (`telegram-webhook.ts:25-32`); `url` is null when
  `TELEGRAM_BOT_USERNAME` is `""` (`telegram.ts:26` in routes); 15-min expiry;
  unique `chatId` index (`db/schema.ts:65`, migration `0001`); additive migration;
  `run_worker_first` includes `/telegram/*`; prod cron adds `*/5 * * * *`;
  Terraform path-scoped bypass app on `/telegram/webhook` gated on
  `custom_domain_active`. No invented behavior.

### No shortcuts

- No hacks, stubs, or TODOs. `parseJsonBody` swallowing a JSON error
  (`telegram-webhook.ts:11-17`) and returning 200 on an unparseable body is
  correct (stops Telegram retries; matches the spec). `makeRealTelegramClient`
  logs rather than throws on a non-OK Bot API response (`telegram.ts:26-28`),
  the right call for fire-and-forget sends. `timingSafeEqual` (`lib/crypto.ts`)
  is a real constant-time SHA-256 digest comparison, reused by both the webhook
  and the e2e auth path.

### Code quality

- Clear and consistent: naming, comment density, schema-parse-at-the-boundary,
  and the DI seam all match the codebase. Boundary types come from `shared/`
  (`TelegramStatus`, `TelegramLinkCode`) and Drizzle (`TelegramRow`); no `as`
  casts. The per-package CLAUDE.md files (db, shared, src, worker, iac) were
  updated in the same change, satisfying the docs-in-same-commit rule.
- Tests are well-targeted: `parseDailyTime` rounding/off/invalid, `dueSlot`,
  `formatMinuteOfDay`, `handleTelegramUpdate` link/expire/prefs/slot/unlinked
  flows, `formatDigestMessage` links/escaping/15-cap/empty, `amsterdamMinuteOfDay`
  across DST, both scheduled paths, and the webhook 200/403 cases. Context notes
  `pnpm check` passes for all steps except network-blocked `terraform validate`
  (`terraform fmt -check` passes), and the e2e spec is written but Playwright's
  browser download is blocked here — not implementation defects.

## Action list (prioritized)

None. All review-1 actions are resolved and no new required changes were found.

VERDICT: APPROVED
