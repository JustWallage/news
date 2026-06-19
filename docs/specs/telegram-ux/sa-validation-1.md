# SA Validation — Telegram UX (command rename, autocomplete, /help, connect flow)

Spec: `docs/specs/telegram-ux/index.md`
Reviewed against branch `telegram-ux` worktree.

## Summary

The spec is sound, right-sized, and fits the codebase. It solves four
well-scoped problems (copy button, clearer connect flow, `/help` + `/`
autocomplete, command rename) without introducing new dependencies or
touching the link-code/webhook/digest invariants. Every claim I could check
against real code holds: the hyphen constraint on `setMyCommands`, the
`buttonVariants`-as-anchor pattern, the deploy-step guard, the JSON-as-source-
of-truth approach, and the e2e env's empty `TELEGRAM_BOT_USERNAME`. No blocking
gaps. Approving with two minor, non-blocking notes the implementer should fold
in.

## Findings by axis

### Soundness — solves the problem, right shape

- The hyphen constraint is real and correctly drives the rename. Telegram's
  `setMyCommands` rejects hyphenated command names; the current commands
  (`worker/lib/telegram-bot.ts:18-27`, `:281-296`) are all hyphenated, so a
  rename to underscore form is genuinely required to get autocomplete. This is
  not gold-plating — it is the minimum to satisfy the user's autocomplete
  request.
- Single source of truth (`bot-commands.json` consumed by both the worker's
  `HELP` derivation and the GHA `setMyCommands` POST) is the correct shape: it
  structurally prevents the in-chat help text and the registered autocomplete
  list from drifting. Today `HELP` is a hand-maintained array (`:18-27`); the
  spec replaces it with a derivation, which is a net simplification of intent.
- Registering commands from the deploy pipeline (vs. on worker boot or via the
  manual curl) is the right call: it is idempotent, runs once per deploy, and
  reuses the existing token guard. `setMyCommands` is a low-frequency
  configuration call, not a per-request concern, so keeping it out of the
  worker runtime is correct.

### Right-sizing — simplest correct

- No new dependencies (no icon library); the copy control is a plain text
  button with a 2s "Copied" state. This matches the existing UI vocabulary
  (the "Sent." / "Could not send." inline feedback in `TelegramSection`).
- The "Open the bot" button reuses `buttonVariants({ size: "lg" })` on an
  anchor — exactly the existing pattern for the "Log out" link
  (`src/pages/PreferencesPage.tsx:155-160`). No new component.
- The PreferencesPage change is explicitly a presentational restructure that
  keeps all data flow (`useCachedFetch`, `connect`, `sendTest`, `code` state)
  intact. No state-machine churn. Appropriately scoped.
- No over-engineering (no command registry abstraction, no runtime
  registration, no migration/alias layer — correctly waived as a single-user
  bot). No under-engineering either: the drift risk between help text and
  autocomplete is the one thing that needed a structural guard, and it gets one.

### Codebase fit — reuse over reinvent, invariants intact

- `buttonVariants` anchor pattern: confirmed in `button.tsx` (exported) and
  already used for "Log out". `size="lg"` exists (`button.tsx:27`). Good fit.
- `code.url` is already nullable end-to-end: `routes/telegram.ts:29-30` sets
  `url = null` when `TELEGRAM_BOT_USERNAME === ""`, and the SPA already guards
  `code.url !== null` (`PreferencesPage.tsx:99`). The spec's conditional render
  of the new button matches the existing contract — no schema change needed.
- The webhook/link-code/digest invariants documented in `worker/CLAUDE.md`
  (one-time link code, fail-closed webhook, slot rounding, digest selection)
  are explicitly out of scope and untouched. The command rename only changes
  the `switch` arm labels and the `setSlot` usage-hint strings — pure
  string/label changes, no behavioural change to side effects.
- JSON import under `bundler` resolution: `tsconfig.base.json` uses
  `moduleResolution: "bundler"`, under which `resolveJsonModule` defaults to
  true, and `tsconfig.worker.json` includes the `worker` dir. Importing
  `worker/lib/bot-commands.json` from `telegram-bot.ts` will type-check without
  a tsconfig change, as the spec claims.
- Deploy step fit: the proposed step lands in the `deploy-prod` job right after
  "Set Telegram worker secrets" (`deploy.yml:113-125`), reusing the identical
  `if [ -n "$TELEGRAM_BOT_TOKEN" ]` guard and the `TELEGRAM_BOT_TOKEN` secret
  already wired into that job. `actions/checkout@v4` runs first in that job
  (`:86`), so `worker/lib/bot-commands.json` is present on disk for the
  `--data @...` curl. Correct.

### Risk / gaps / failure modes

- `curl -fsS` will fail the deploy step if `setMyCommands` returns non-2xx
  (e.g. malformed payload). Since the same JSON also feeds the worker's HELP at
  build/type time and the payload is static, the risk is low, but a typo in the
  JSON would surface as a red deploy step rather than silently — acceptable and
  arguably desirable.
- `noFallthroughCasesInSwitch` is on (`tsconfig.base.json`). The new `/help`
  case and existing cases all `return`, so no fallthrough issue.
- knip: `HELP` stays module-internal (not exported), and `bot-commands.json`
  is imported, so no unused-export/file failure. The GHA references the JSON by
  path (not an import), which is fine — knip won't flag a committed data file
  that is also imported by the worker.
- jscpd (`.jscpd.json`, minTokens 70, threshold 1): low risk. The HELP
  derivation is a small `.map().join()`; the deploy YAML is not in the jscpd
  pattern (`{src,worker,shared,db}`). No duplication concern.

### Open questions

1. **`GREETING` / `NOT_LINKED` say "tap Connect Telegram"** (`telegram-bot.ts:38-44`)
   but the SPA button is being renamed to "Generate start command". The spec
   marks these strings "unchanged." This is a minor copy inconsistency the user
   will see in-chat ("tap Connect Telegram" — a button that no longer exists).
   Recommended answer: update both strings to reference "Generate start
   command" (or a neutral phrasing like "open the app's preferences page and
   generate a start command"). Non-blocking, but should be folded in since the
   spec is already editing this file and renaming that button.

2. **HELP shape vs. arguments.** Today HELP encodes argument hints
   (`/daily-time HH:MM — ...`, `/set-preferences <text> — ...`,
   `telegram-bot.ts:18-27`). The new `bot-commands.json` descriptions drop the
   inline arg syntax (e.g. "Set what you want to read" instead of
   `<text>`). The derived HELP will therefore be slightly less instructive than
   today's. This is acceptable — `setMyCommands` descriptions are short by
   convention, the per-command usage hints from `setSlot`/`setPreferences`
   still fire on bad input, and `/daily_time`'s description keeps "(HH:MM, or
   off)". Recommended answer: accept as-is; the loss is cosmetic and the
   autocomplete descriptions read better short. No change required.

## Spec-change list (non-blocking)

1. Add to Requirement 2: update `GREETING` and `NOT_LINKED` (`telegram-bot.ts:38-44`)
   to stop referencing the removed "Connect Telegram" button label, matching the
   SPA's new "Generate start command" wording. (Currently the spec says these are
   "unchanged," which leaves a user-visible copy mismatch.)
2. Optional clarification in Requirement 2: state explicitly that the derived
   HELP no longer carries inline argument hints (`<text>`, `HH:MM`), so the
   implementer doesn't try to reconstruct them and reintroduce drift.

Neither blocks implementation; both are small copy/scope clarifications within
files the spec already touches.

VERDICT: APPROVED
