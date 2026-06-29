# Review 2 — Rate-limit the Telegram `/fetch` command

## Summary

The branch applies the existing per-user `digest_runs` cooldown to the Telegram
`/fetch` path so it shares one budget with the homepage Refresh. The decision is
made in `handleTelegramUpdate` (pure, given `cooldownMs`/`now` from the route),
and a throttled `/fetch` now delivers the user's EXISTING curations via a new
`recurate` flag on `sendDailyDigest` rather than refusing with text only. `pnpm
check` passes (106 tests, exit 0; the `env.e2e` "ai" wrangler warnings are
pre-existing and unrelated). The backlog note was moved (not deleted) to
`docs/3-done/`. All spec requirements are met.

## Spec-requirement verification

- Req 1 (throttled `/fetch` skips AI, still delivers existing feed + note): met.
  `worker/lib/telegram-bot.ts:357-369` returns `recurate: false` with `feedFor`
  set and the `⏳ … latest feed … Try again in N min` note;
  `worker/lib/scheduled.ts:30-36` gates `runDigest` behind `recurate`.
- Req 2 (shared budget): met. `/fetch` calls `recordDigestRun` on the allowed
  path (`telegram-bot.ts:371`) against the same `digest_runs` table the web
  route uses; the integration test asserts cross-path keying via `digest_runs`.
- Req 3 (cron stays unthrottled): met. `sendDueDigests`/cron does not pass
  `cooldownMs` and does not call `recordDigestRun`; only the webhook route wires
  the cooldown in. Verified the change set touches no scheduled-cron path.
- Req 4 (`cooldownMs <= 0` fully unthrottled, no env branch): met. The
  short-circuit in `rate-limit.ts:17-19` handles it; the webhook passes
  `env.DIGEST_COOLDOWN_SECONDS * 1000` with no branching.

## Findings per axis

### Simplicity — clean

The `recurate` flag (default `true`) is the minimal way to share `sendDailyDigest`
between the fresh and existing-feed cases. The decision stays pure in
`handleTelegramUpdate`; env knowledge stays in the route. No unnecessary
abstraction introduced.

### Spec implementation — clean

All four requirements and both design decisions (decision point, record-at-
decision-time) implemented as written, including the exact throttle-note wording
and `N = Math.ceil(remaining / 60_000)`.

### No shortcuts — clean

No stubs, TODOs, swallowed errors, or hacks. The webhook still acks `200`
unconditionally (Telegram contract unchanged). Record-at-decision-time is
synchronous before `waitUntil`, matching the design's abuse-bounding rationale.

### Code quality — clean

Follows conventions: schema/Drizzle types reused, no `as` casts, comments are
short and explain non-obvious intent (the `recurate` seam, the synchronous
record). `worker/CLAUDE.md` updated to replace the stale "`/fetch` is NOT
rate-limited" line with the shared-budget behavior, per the Docs section.

### Tests — clean

Both planned tests landed and are meaningful:

- `worker/lib/telegram-bot.test.ts:157-172` drives `/fetch` twice with
  `cooldownMs = 600_000`, asserting `recurate: true` then `recurate: false` plus
  the note text.
- `worker/routes/api.test.ts:413-480` drives the real `/telegram/webhook`
  `/fetch` twice with `DIGEST_COOLDOWN_SECONDS: 600`, flushing each `waitUntil`
  via `createExecutionContext`/`waitOnExecutionContext`, and asserts exactly one
  `digest_runs` row whose `lastRunAt` is unchanged after the throttled call
  (proving the second call neither records nor re-stamps). Given
  `recordDigestRun` upserts `lastRunAt`, the unchanged-timestamp assertion is a
  real signal.

## Backlog move

`git diff main...HEAD --find-renames` reports
`rename docs/{0-backlog => 3-done}/ratelimit-telegram-fetch.md (90%)`, and the
file now lives in `docs/3-done/`. Moved, not deleted, and its body was updated to
reflect the send-existing-curations behavior.

## Action list

None.

VERDICT: APPROVED
