# Review 1 — telegram-ux

Spec: `docs/specs/telegram-ux/index.md`
Branch: `telegram-ux` vs `main`

## Summary

The implementation is faithful to the spec across nearly every requirement: the
new `worker/lib/bot-commands.json` source of truth, the underscore command
rename, the derived `HELP`/`/help` handler, the GHA `setMyCommands` step, the
`PreferencesSection` redesign with copy button and `size="lg"` "Open the bot"
anchor, and the unit + e2e test updates. `pnpm check` passes green (60 unit
tests). One real defect remains: a live, user-facing bot reply still emits the
old hyphenated command name, which after the rename points users at a command
that no longer exists.

## Findings

### Simplicity — clean

The changes are the simplest correct shape. `HELP` is derived from the JSON via a
single `map`; the section restructure is presentational only and preserves the
existing `connect`/`sendTest`/`code` data flow as the spec required. No
over-engineering.

### Spec implementation — one gap

- **`worker/lib/telegram-bot.ts:178`** — the empty-arg usage hint still reads
  `"Add the text after the command: /set-preferences <your interests>"`. After
  the rename this is a stale, broken instruction: the user must send
  `/set_preferences`, and `/set-preferences` is no longer a registered command
  (Telegram cannot even register the hyphen form). This is exactly the
  "reference where a command name is actually written out" the spec asks to
  update (Requirement 5), and it is the most user-visible of the leftovers
  because it is a runtime reply, not a doc.
  Fix: change to `/set_preferences <your interests>`.

  All other rename points required by Requirement 2 (the `switch` cases,
  `setSlot` label, `GREETING`/`NOT_LINKED` copy) are correctly done.

- The JSON payload, GHA step, README/BOOTSTRAP/worker CLAUDE.md edits, and the
  PreferencesSection structure all match the spec's enumerated requirements.

### No shortcuts — clean

No stubs, swallowed errors, or TODOs that matter. The clipboard `.catch()`
deliberately leaves the button on "Copy" — this is the spec's intended behaviour
(documented inline), not a swallowed error.

### Code quality — minor

- **`worker/routes/telegram-webhook.ts:44`** — comment still says `/fetch-feed`;
  the command is now `/fetch`. Stale prose, non-functional, but the project's doc
  standard says to keep references current. Worth a one-word fix while touching
  the rename.
- `worker/lib/telegram-bot.test.ts:171` test description says "daily-time slot"
  (cosmetic, test still asserts the underscore form correctly).
- Historical artifacts `docs/specs/telegram-bot.md` and
  `docs/backlog/telegram-bot.md` still contain hyphenated names. These are
  prior-feature spec/backlog captures (one is a verbatim original-request quote);
  editing them is out of the spirit of "minimal edits" and not required.
- `buttonVariants` is imported and used correctly; the "Open the bot" anchor uses
  `target="_blank" rel="noopener noreferrer"` as specified.

### Tests — clean

Unit tests cover the rename, `/help` (asserts `/fetch` and `/help`), and the
unknown-command fallback (`/bogus` equals help reply). The e2e grants
`clipboard-write`, renames the button to "Generate start command", and asserts
the Copy → Copied transition. Coverage matches the spec's Tests section.

## Action list

1. (required) `worker/lib/telegram-bot.ts:178` — change `/set-preferences` to
   `/set_preferences` in the usage hint.
2. (recommended) `worker/routes/telegram-webhook.ts:44` — update the `/fetch-feed`
   comment to `/fetch`.

VERDICT: CHANGES_REQUESTED
