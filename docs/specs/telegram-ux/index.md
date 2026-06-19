# Telegram UX: command rename, autocomplete, `/help`, and a clearer connect flow

## Original request (verbatim)

> Add a copy button next to the telegram command
> Make the "Open the bot" button a bit bigger and open in a new tab. Also make
> the telegram section a bit bigger and more logically designed in general. Eg a
> short a instruction, then a step plan, a generate start command button that
> then generates the code, and below that a open bot button. Everything is a bit
> cramped now and now very clear. Improve this flow.
>
> Also add a /help command to the bot. And also, for other bots they have
> autocomplete when I type / in the input field which shows the possible
> commands, can you make that possible for this bot as well? Also, rename
> /fetch-feed to /fetch

## Context

This is a single-user personal app (`just@wallage.nl`). The Telegram bot lets the
user set preferences and schedule daily summaries from chat. Relevant code:

- `worker/lib/telegram-bot.ts` — pure command handler (`handleTelegramUpdate`),
  the `HELP` text, and the `/start` link flow. Unit-tested in
  `worker/lib/telegram-bot.test.ts`.
- `worker/lib/telegram.ts` — `TelegramClient` seam (real Bot API vs no-op fake).
- `worker/routes/telegram.ts` — mints the link code; builds the `t.me` deep-link
  `url` (null when `TELEGRAM_BOT_USERNAME` is `""`, which is the committed/e2e
  default).
- `src/pages/PreferencesPage.tsx` — `TelegramSection` renders the connect UI.
- `.github/workflows/deploy.yml` — `deploy-prod` job; already has a "Set Telegram
  worker secrets" step that runs only when `TELEGRAM_BOT_TOKEN` is set. The repo
  is checked out in this job.
- Telegram setup (`setWebhook`) is a manual one-time curl documented in
  `docs/BOOTSTRAP.md`.

No icon library is installed; the only `svg` styling in `button.tsx` is layout
hooks. The `Button` component (`src/components/ui/button.tsx`) exposes variants
(`default`, `outline`, `secondary`, `ghost`, `destructive`, `link`) and sizes
(`default`, `sm`, `lg`, `icon*`, …) and an exported `buttonVariants` helper used
to style anchors as buttons (see the "Log out" link).

## Hard Telegram constraint (drives the rename)

Telegram's `setMyCommands` (the API that powers the `/`-autocomplete dropdown)
only accepts command names matching `[a-z0-9_]{1,32}` — **hyphens are rejected**.
The current commands `/set-preferences`, `/cur-preferences`, `/daily-time`,
`/daily-time-2`, `/daily-time-3` therefore cannot be registered as-is. To get
autocomplete for every command they must be renamed to underscore form.

## Decisions

- **[user]** `setMyCommands` is registered from the **GitHub Actions deploy
  pipeline**, as a new step in the `deploy-prod` job immediately after the
  existing "Set Telegram worker secrets" step, guarded the same way
  (`if [ -n "$TELEGRAM_BOT_TOKEN" ]`).
- **[user]** Rename all hyphenated commands to underscore form — a clean break,
  **no hyphen aliases** (single-user bot, no migration concern):
  `/set_preferences`, `/cur_preferences`, `/daily_time`, `/daily_time_2`,
  `/daily_time_3`.
- **[user]** Rename `/fetch-feed` → `/fetch`.
- **[AI]** Single source of truth for the command list: a new
  `worker/lib/bot-commands.json` holding the exact `setMyCommands` payload
  (`{ "commands": [{ "command", "description" }] }`, underscore names, no leading
  slash). The worker imports it to derive the `HELP` text; the GHA step POSTs the
  same file. JSON import type-checks cleanly under the repo's `bundler`
  resolution (verified — no tsconfig change needed).
- **[AI]** `/start` is intentionally **excluded** from the autocomplete list (it
  is code-gated and only used once via the deep link; Telegram treats `/start`
  specially).
- **[AI]** Add an explicit `/help` command that returns the help text; unknown
  commands continue to fall back to the same help text.
- **[AI]** No new icon dependency. The copy control is a small text button that
  reads "Copy" and switches to "Copied" for ~2s after a successful copy.
- **[AI]** "Open the bot" becomes a prominent **`size="lg"`** anchor styled via
  `buttonVariants` (default/primary variant), opening in a new tab
  (`target="_blank" rel="noopener noreferrer"`). It renders only when the
  deep-link `url` exists (i.e. `TELEGRAM_BOT_USERNAME` is set in prod).
- **[AI]** e2e cannot assert the "Open the bot" link: in the e2e/committed env
  `TELEGRAM_BOT_USERNAME` is `""`, so `url` is null and the button is hidden.
  Its new-tab behaviour is covered by code review, not e2e.

## Requirements

### 1. Command source of truth — `worker/lib/bot-commands.json` (new)

Exact `setMyCommands` request body:

```json
{
  "commands": [
    { "command": "user", "description": "Show the connected account" },
    {
      "command": "fetch",
      "description": "Fetch a fresh feed now and send it here"
    },
    {
      "command": "set_preferences",
      "description": "Set what you want to read"
    },
    {
      "command": "cur_preferences",
      "description": "Show your current preferences"
    },
    {
      "command": "daily_time",
      "description": "Set a daily summary time (HH:MM, or off)"
    },
    {
      "command": "daily_time_2",
      "description": "Set a second daily summary time"
    },
    {
      "command": "daily_time_3",
      "description": "Set a third daily summary time"
    },
    { "command": "help", "description": "Show available commands" }
  ]
}
```

### 2. `worker/lib/telegram-bot.ts`

- Import `bot-commands.json` and derive `HELP` from it so the in-chat help and
  the registered autocomplete list can never drift. Format each line as
  `/<command> — <description>`, preceded by a `Commands:` header (same shape as
  today). Example first lines:
  ```
  Commands:
  /user — Show the connected account
  /fetch — Fetch a fresh feed now and send it here
  ...
  ```
- Update the `switch` in `handleTelegramUpdate`:
  - `case "/fetch":` (was `/fetch-feed`) — same behaviour (`feedFor` ack).
  - `case "/set_preferences":` (was `/set-preferences`).
  - `case "/cur_preferences":` (was `/cur-preferences`).
  - `case "/daily_time":` (was `/daily-time`) → `setSlot(…, 0, …)`.
  - `case "/daily_time_2":` → `setSlot(…, 1, …)`.
  - `case "/daily_time_3":` → `setSlot(…, 2, …)`.
  - add `case "/help":` returning `{ chatId, reply: HELP }`.
  - `default:` continues to return `HELP`.
- Update `setSlot`'s `command` label to underscore form:
  `index === 0 ? "/daily_time" : "/daily_time_${index + 1}"` (used in the usage
  hints it returns).
- Update `GREETING` / `NOT_LINKED` in-chat copy: they currently say "tap Connect
  Telegram" but the button is being renamed — change that phrase to "tap Generate
  start command" so the in-chat instructions match the UI. The `/start <code>`
  mechanics are unchanged.

### 3. `.github/workflows/deploy.yml`

Add a step to the `deploy-prod` job, immediately after "Set Telegram worker
secrets":

```yaml
# Register the bot's slash-command list so Telegram shows autocomplete.
# Same token guard as above; the command list is the single source of
# truth shared with the worker (worker/lib/bot-commands.json).
- name: Register Telegram bot commands
  env:
    TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
  run: |
    if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
      curl -fsS -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands" \
        -H "Content-Type: application/json" \
        --data @worker/lib/bot-commands.json
    fi
```

### 4. `src/pages/PreferencesPage.tsx` — `TelegramSection` redesign

Restructure into a clear, less-cramped flow with more vertical breathing room
(e.g. `space-y-3`/`space-y-4`, `pt-5`):

1. **Heading** — `Telegram` label.
2. **Short instruction** — one sentence, e.g. "Get your daily news summaries in
   Telegram."
3. **Connection status** (only when linked) — the existing `statusText`
   (connected-as + slot times / hint).
4. **Step plan** — a numbered list (`<ol>`), readable, e.g.:
   1. Generate your start command below.
   2. Copy it and open the bot.
   3. Send it to the bot to connect.
5. **Controls row** — a button that mints the code:
   - label: "Generate start command" when no code yet, "Regenerate" once a code
     exists, "Generating…" while pending. (Reuses the existing `connect()`.)
   - the existing "Send test message" button stays here when `linked`, with its
     Sent / Could not send feedback.
6. **Generated command block** (only when `code !== null`), below the controls:
   - the command shown as before:
     `<code>/start {code.code}</code>` styled like today.
   - **Copy button** next to it: copies `"/start " + code.code` via
     `navigator.clipboard.writeText`; on success shows "Copied" for ~2s then
     reverts to "Copy". Small (`size="sm"`), unobtrusive variant.
   - the expiry note ("This code expires in 15 minutes.").
   - **"Open the bot" button** below (only when `code.url !== null`): an anchor
     styled with `buttonVariants({ size: "lg" })` (default/primary variant),
     `target="_blank" rel="noopener noreferrer"`, href `code.url`.

Keep all existing data flow (`useCachedFetch`, `connect`, `sendTest`, `code`
state) intact; this is a presentational restructure plus the copy control.

### 5. Docs

- `docs/BOOTSTRAP.md` — note that the bot's command list (autocomplete) is
  registered automatically on every deploy from `worker/lib/bot-commands.json`
  (no manual step), and update any command examples to the new names
  (`/daily_time`).
- Update any other references to the renamed commands in docs that mention them
  (grep `daily-time`, `fetch-feed`, `set-preferences`, `cur-preferences` under
  `docs/`, `README.md`, `worker/CLAUDE.md`). Keep edits minimal and only where a
  command name is actually written out.

## Tests

### Unit — `worker/lib/telegram-bot.test.ts`

- Update existing tests that use old names to the new ones: `/fetch` (was
  `/fetch-feed`), `/cur_preferences`, `/set_preferences`, `/daily_time_2`.
- Add: `/help` returns the help text (assert it `toContain("/fetch")` and
  `toContain("/help")`).
- Add: an unknown command (e.g. `/bogus` from a linked chat) falls back to the
  help text.
- Existing `/fetch` test still asserts `reply` contains "few seconds" and
  `feedFor === USER`.

### e2e — `e2e/telegram.spec.ts`

- Update the button name from "Connect Telegram" to "Generate start command".
- After clicking: `/start [0-9a-f]{8}` visible and "expires in 15 minutes"
  visible (unchanged assertions).
- Grant clipboard permission for the page
  (`page.context().grantPermissions(["clipboard-write"])`), assert the "Copy"
  button is visible, click it, and assert "Copied" appears.
- (Open-the-bot link is not asserted — hidden in the e2e env because
  `TELEGRAM_BOT_USERNAME` is `""`.)

## Out of scope

- No new runtime dependencies (no icon library).
- No change to the `/start` link-code minting, expiry, or webhook auth.
- No change to digest selection or scheduling logic.
