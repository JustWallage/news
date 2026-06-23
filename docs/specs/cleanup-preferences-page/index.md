# Redesign the preferences page

## Request (verbatim)

> Update the preferences page to be clearer design and sections split better visible.
>
> Also cleanup the preferences page UI. It's currently a bit chaotic and not clear what belongs together and the overview.
>
> Also it is now very unclear (or impossible) when a daily summary time has been set or cleared. Make this much clearer, use greyed out eg
>
> Also move the copy start command part under the open bot button. In fact make it clear that the open bot button also links your account at the same time. Perhaps come up with a better name as well "Link my account" or something similar/more intuitive.
>
> You have full agency to redesign this page, it should be minimal, not too flashy/fancy, but mostly clean and logical.

## Scope

Pure front-end redesign of `src/pages/PreferencesPage.tsx`. No API, schema, worker,
or DB changes. All existing data flows (preferences text save, telegram link-code
generation, timezone PUT, slots PUT, send-test, disconnect) stay exactly as they are
today — only the layout, grouping, copy, and the set/cleared affordance change.

## Current state (what's wrong)

The page is one flat column: an email/logout row, the interests textarea + Save, then a
long `TelegramSection` that crams together — in this order — a Telegram heading, the
"Connected as…" line, the daily-time slots, the timezone `<select>`, a numbered
how-to list, a "Generate start command" button + "Send test message", and finally a
generated-code block with a "Copy" button and an "Open the bot" link. Nothing is
visually grouped, so it reads as chaos. Two specific failures the user calls out:

1. An empty time slot renders as a native `--:--` time input — indistinguishable from
   "not set yet". You cannot tell at a glance whether a daily summary time is set or cleared.
2. The connect flow buries the action: the code block and "Copy" appear first, the
   "Open the bot" link is last and unexplained, so it is not obvious that opening the
   bot is what actually links the account.

## Target design

Use the existing `Card` family (`src/components/ui/card.tsx`) to split the page into
clearly separated sections. Keep it minimal — no new colors, no flashy effects, reuse
the existing button/input/label/card primitives and `cn`. Page width is already
constrained by `Layout` (`max-w-3xl`). Stack the cards with `space-y-6` (or similar).

### Top row (not a card)

A muted account row: signed-in email on the left, `Log out` button (outline, sm) on
the right. Same behavior as today.

### Card 1 — "Your interests" (always shown)

- `CardHeader`: `CardTitle` "Your interests", `CardDescription` reusing today's copy
  ("Describe what you want to read in plain text. The morning filter uses this to pick stories.").
- `CardContent`: the `Textarea` (id `preferences`, label "Your interests" preserved for
  the e2e label lookup), same `dirty` seeding guard, same placeholder, ~rows 14–16.
- Footer area: the `Save` button + the idle/saving/saved/error status text (unchanged logic).

### Card 2 — "Telegram" (always shown) — connection

`CardHeader`: title "Telegram", description "Get your daily news summaries in Telegram."

**When NOT linked** — the connect flow, reordered per the request:

- One short sentence explaining the flow, e.g. "Generate a connect link, open it, and
  your account links automatically."
- Primary button labeled **"Generate connect link"** (was "Generate start command").
  While the POST is in flight show "Generating…".
- After a code exists, reveal a block (the existing `code !== null` branch, restructured)
  in this top-to-bottom order:
  1. **The bot link first**, as the prominent primary action. When `code.url !== null`,
     render the anchor (keep `buttonVariants`, prominent size) labeled **"Link my account"**.
     Immediately under/beside it make explicit that opening it links the account, e.g.
     "Opens Telegram and links your account automatically."
  2. **Below the link**, the manual fallback: a short lead like "Or send this to the bot
     yourself:", then the `/start <code>` `<code>` block + the `Copy`/`Copied` button
     (unchanged copy logic), then "This code expires in 15 minutes."
  3. A subtle secondary affordance to regenerate (ghost/sm button or link, e.g.
     "Generate a new link") that calls the same `connect()`.
- If `code.url === null` (deep link unavailable), the manual command block is the only
  path — show it without the "Link my account" anchor. Preserve this fallback.

**When linked:** the connect-code generation UI (the "Generate connect link" button and
the code/link reveal block) is removed entirely — it is not relocated. Today's component
reuses that button as "Regenerate"; the redesign drops it from the linked state.

- A clear "Connected as @handle." line (or "Connected." when no label) — keep today's
  `who` computation.
- Actions in the card footer: `Send test message` (outline; "Sending…"/"Sent."/"Could
  not send." statuses unchanged) and `Disconnect` (destructive; "Disconnecting…";
  opens the existing `ConfirmDialog`). Keep the `ConfirmDialog` and its copy unchanged.

### Card 3 — "Daily summaries" (shown ONLY when linked)

This card replaces today's "Daily summary times" block and owns the timezone, because
timezone is what schedules the summaries — they belong together.

- `CardHeader`: title "Daily summaries", description "Up to three times a day, in your timezone."
- Timezone: the `Timezone` label + `<select>` (id `timezone`, label preserved), same
  `changeTimezone` PUT logic.
- The three slots, redesigned for an unambiguous set/cleared state. Render each slot as
  its own labeled row (First / Second / Third):
  - **Set** (value !== ""): the time `Input` at normal emphasis + the existing trash
    `Button` (ghost icon, aria-label `Clear <name>`) to clear it.
  - **Cleared** (value === ""): the time `Input` styled muted/greyed (e.g. add
    `text-muted-foreground bg-muted/40` or equivalent via `cn`) AND an explicit
    **"Not set"** text indicator next to it, so the empty state is obvious. No trash button.
  - Preserve the existing aria-labels exactly: `First daily summary time`,
    `Second daily summary time`, `Third daily summary time` (used by e2e), and
    `Clear <name>`. Keep `SLOT_LABELS = ["First","Second","Third"]`, `step={300}`,
    and the `slotsDirty` seeding guard.
- Footer area: `Save times` button (was/keep this exact label; "Saving…"/"Saved."/"Could
  not save." statuses unchanged) + status text.

## Decisions

- **[user]** Link flow: "Generate, then reveal". The trigger button reads
  **"Generate connect link"**; clicking it mints the code on demand, then reveals the
  "Link my account" bot link plus the copy-command fallback. No pre-generating on load.
- **[AI]** Section split via the existing `Card` component (strongest visual grouping,
  already in the design system, no new primitives).
- **[AI]** Timezone moves into the linked-only "Daily summaries" card (it schedules the
  summaries). Before linking, `connect()` keeps using the browser-detected default
  timezone exactly as today; the user adjusts it after linking. This means the timezone
  selector is no longer visible to an unlinked user.
- **[AI]** Empty slot affordance = muted/greyed input + explicit "Not set" label (the
  user's "greyed out eg" plus a textual cue for certainty).
- **[AI]** Drop the numbered how-to `<ol>`; replace with one explanatory sentence in the
  connect flow.
- **[AI]** "Open the bot" → "Link my account"; the copy-command block moves beneath it.

## Constraints (from CLAUDE.md)

- No `as` casts (only `as const`). No unused exports (knip). Min comments — only for
  non-obvious code; never narrate the change.
- `pnpm check` must pass; e2e coverage for logic changes.
- Keep all schema/types from `@shared/api`; do not redefine types locally.

## Tests

Update the affected e2e specs and add coverage for the new set/cleared affordance.

`e2e/telegram.spec.ts`:

- Rename the button lookup `"Generate start command"` → `"Generate connect link"`.
- The "reveals a connect code" test: after generating, assert the `/start <code>` and
  "expires in 15 minutes" are visible and Copy → Copied works (unchanged). NOTE:
  `wrangler.jsonc` sets `TELEGRAM_BOT_USERNAME: ""` for the `e2e` env, so the link-code
  `url` is null and the "Link my account" anchor does NOT render in e2e — the test must
  assert the manual `/start <code>` block, not the bot link.
- "Daily summary times" hidden/visible assertions → the new section heading
  **"Daily summaries"** (hidden when unlinked, visible when linked).
- Timezone test ("the timezone selector persists the chosen zone"): the selector now
  lives in the linked-only "Daily summaries" card, so link a chat first (reuse
  `linkChat`) before selecting the zone; assert it persists across reload.
- Disconnect and trash-button tests: keep working — preserve the `Disconnect`,
  `Save times`, and `Clear First daily summary time` / `First daily summary time`
  labels so these specs need no selector changes.
- **Add** a test asserting an unset slot shows the "Not set" indicator. Scope the
  assertion to a single slot row (three empty slots yield three "Not set" nodes) — e.g.
  locate the row by the `First daily summary time` input's container, assert "Not set"
  within it; fill + save it, assert that row no longer shows "Not set".

`e2e/preferences.spec.ts`: keep passing — preserve the `Your interests` label, `Save`
button, signed-in email, and `Log out` button.

## Out of scope

API/worker/schema/DB changes; new dependencies; any change to curation, cron, or
telegram backend behavior.
