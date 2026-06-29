# Review: Rate-limit the Telegram `/fetch` command

## Summary

The change applies the existing per-user `digest_runs` cooldown to the Telegram
`/fetch` path. The decision now lives in `handleTelegramUpdate` (pure, takes
`{ cooldownMs, now }`); the webhook supplies `DIGEST_COOLDOWN_SECONDS * 1000` and
a shared `now`. A throttled `/fetch` replies with a minutes-remaining message and
returns no `feedFor`; an allowed `/fetch` records the run synchronously before the
background `waitUntil` digest. The implementation matches the spec's design
decisions closely and `pnpm check` is green (106 tests, exit 0).

Verdict: APPROVED.

## Findings by axis

### Simplicity — clean

Minimal, well-scoped change. Reuses `digestCooldownRemainingMs` /
`recordDigestRun` rather than introducing a parallel mechanism. The `opts`
parameter with defaults (`{ cooldownMs: 0, now: new Date() }`) keeps every other
command call site untouched and unthrottled, which is the simplest correct shape.

### Spec implementation — clean

All four requirements met:

- Req 1 (throttled `/fetch` does not run AI, replies with minutes): `worker/lib/telegram-bot.ts:354-366` returns the throttle reply with no `feedFor` when `remaining > 0`, so the webhook never enters the `waitUntil` digest branch.
- Req 2 (shared single budget): both paths use `digest_runs` keyed on `userEmail`; `recordDigestRun` at `worker/lib/telegram-bot.ts:368` stamps the same row the web Refresh uses.
- Req 3 (cron stays unthrottled): `sendDueDigests` / cron path is untouched; no cooldown logic added there.
- Req 4 (`cooldownMs <= 0` unthrottled, no env branch): handled entirely by the existing short-circuit in `digestCooldownRemainingMs` (`worker/lib/rate-limit.ts:17`). No environment branching introduced in `telegram-bot.ts`.

Design decisions honored: decision point in `handleTelegramUpdate`, env knowledge
stays in the route (`worker/routes/telegram-webhook.ts:41`), record-at-decision-time
(before `waitUntil`), throttle message exactly `⏳ You just refreshed — try again
in N min.` with `N = Math.ceil(remaining / 60_000)`, and the webhook still acks 200.

Nice extra: the webhook now passes the same `now` into `sendDailyDigest`
(`worker/routes/telegram-webhook.ts:59`) instead of a fresh `new Date()`, keeping
the recorded run and the digest timestamp consistent.

### No shortcuts — clean

No stubs, TODOs, swallowed errors, or hacks. No `as` casts. The record happens
unconditionally on the allowed path; abuse is bounded even if the background
digest later fails, which is the deliberate, stronger behavior the spec calls out.

### Code quality — clean

Comments are short, inline, and explain the non-obvious (why the run is recorded
synchronously, why `now` is shared). Follows existing conventions; types cross the
boundary via Drizzle inference. `worker/CLAUDE.md` updated correctly: the stale
"Telegram `/fetch` ... NOT rate-limited" note now reflects the shared budget and
limits the unthrottled claim to cron only — satisfying the Docs section.

### Tests — clean

- Unit (`worker/lib/telegram-bot.test.ts:157`): drives `/fetch` twice with
  `cooldownMs = 600_000`; asserts first has `feedFor`, second has
  `feedFor === undefined` and a "try again" reply. Matches spec test 1.
- Integration (`worker/routes/api.test.ts:413`): drives the real
  `/telegram/webhook` `/fetch` twice with `DIGEST_COOLDOWN_SECONDS: 600` override;
  asserts exactly one `digest_runs` row and that the second call does not advance
  `lastRunAt`. Matches spec test 2. Correctly uses `createExecutionContext` +
  `waitOnExecutionContext` to flush the first call's `waitUntil` digest before the
  test pool tears down storage, and resets `digestRuns` in `beforeEach` in both
  suites for hermeticity.

The spec's reasoning for skipping Playwright e2e (cooldown is 0 in e2e, reply goes
to a fake client, `waitUntil` not flushed) is sound; coverage lands where it is
observable. This is consistent with the repo rule (logic changes get tests) given
the e2e constraint.

## Action list

None.

VERDICT: APPROVED
