# Review 2 — telegram-ux

Spec: `docs/specs/telegram-ux/index.md`
Branch: `telegram-ux` vs `main`
Prior review: `docs/specs/telegram-ux/review-1.md` (CHANGES_REQUESTED — two items)

## Summary

Both fixes requested by review-1 are resolved, and the implementation remains
faithful to the spec across every requirement. The single source of truth
(`worker/lib/bot-commands.json`) drives both the derived `HELP`/`/help` reply and
the GHA `setMyCommands` step; the underscore rename is applied consistently
across the `switch`, `setSlot`, the empty-arg usage hints, and the
`GREETING`/`NOT_LINKED` copy; the `TelegramSection` redesign matches the
prescribed flow with the copy control and `size="lg"` "Open the bot" anchor; and
unit + e2e tests cover the new behaviour. `pnpm check` passes green (60 unit
tests, exit 0).

## Prior-review fixes — both resolved

1. **`/set-preferences` usage hint** — `worker/lib/telegram-bot.ts:178` now reads
   `"Add the text after the command: /set_preferences <your interests>"`. The
   stale hyphenated runtime reply is gone.
2. **Stale `/fetch-feed` webhook comment** — `worker/routes/telegram-webhook.ts:44`
   now reads `// /fetch: run the digest and send the feed after acking …`.

## Findings

### Simplicity — clean

`HELP` is derived from the JSON with a single `map` over `botCommands.commands`,
so the in-chat help and the registered autocomplete list cannot drift. The
section restructure is presentational and preserves the existing
`connect`/`sendTest`/`code` data flow exactly as the spec required. No
over-engineering.

### Spec implementation — clean

- `worker/lib/bot-commands.json` matches the spec payload byte-for-byte:
  underscore command names, no leading slash, exact descriptions, eight commands
  in the prescribed order (`/start` correctly excluded).
- `worker/lib/telegram-bot.ts` — JSON-derived `HELP`, all `switch` cases renamed
  (`/fetch`, `/set_preferences`, `/cur_preferences`, `/daily_time[_2|_3]`), new
  `/help` case, `default` still falls back to `HELP`, `setSlot` label uses
  underscore form, and both `GREETING`/`NOT_LINKED` now say "tap Generate start
  command".
- `.github/workflows/deploy.yml` — the "Register Telegram bot commands" step is
  placed immediately after "Set Telegram worker secrets", uses the same
  `if [ -n "$TELEGRAM_BOT_TOKEN" ]` guard, and POSTs `--data @worker/lib/bot-commands.json`.
- `src/pages/PreferencesPage.tsx` — heading + one-sentence instruction, linked
  status line, numbered `<ol>` step plan, controls row (Generate/Regenerate/
  Generating… plus the linked-only Send test message), and the generated-command
  block with `/start {code}`, a `size="sm"` outline Copy button that flips to
  "Copied" for 2s, the 15-minute expiry note, and the `buttonVariants({ size: "lg" })`
  "Open the bot" anchor with `target="_blank" rel="noopener noreferrer"` gated on
  `code.url !== null`. The slot-time hint text was also updated to `/daily_time`.
- Docs — `README.md`, `docs/BOOTSTRAP.md`, and `worker/CLAUDE.md` updated to the
  new command names and the auto-registration note; edits are minimal and only
  where a command name is written out.

### No shortcuts — clean

No stubs, TODOs, or swallowed errors of concern. The clipboard `.catch()` that
leaves the button on "Copy" is the spec's intended behaviour, documented inline.

### Code quality — clean

The JSON import type-checks under bundler resolution with no tsconfig change.
`buttonVariants` is imported and applied correctly. The `worker/CLAUDE.md` note
captures the non-obvious invariant (single source of truth, hyphen rejection)
per the docs standard. The previously-noted cosmetic test-description nit from
review-1 is not present in the current code; no remaining quality issues.

### Tests — clean

- Unit (`worker/lib/telegram-bot.test.ts`): renamed existing tests to `/fetch`,
  `/cur_preferences`, `/set_preferences`, `/daily_time_2`; the `/fetch` test still
  asserts "few seconds" and `feedFor === USER`; a new test asserts `/help`
  contains `/fetch` and `/help`, and that `/bogus` falls back to the same help
  reply.
- e2e (`e2e/telegram.spec.ts`): grants `clipboard-write`, uses the "Generate
  start command" button name, asserts the `/start [0-9a-f]{8}` code and "expires
  in 15 minutes", then clicks Copy and asserts "Copied". The Open-the-bot anchor
  is correctly left unasserted (hidden in the e2e env where
  `TELEGRAM_BOT_USERNAME` is `""`), as the spec notes.

### Gate

`pnpm check` exits 0 (format, lint, types, knip, jscpd, terraform, 60 unit
tests). The `env.e2e` wrangler "ai" warning is a pre-existing, non-fatal config
note unrelated to this change.

## Action list

None. Both prior-review items are resolved and all axes are clean.

VERDICT: APPROVED
