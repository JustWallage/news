# SA Validation 2 — Public Google sign-in + multi-user Telegram digest (re-review)

Spec: `docs/specs/public-google-auth/index.md`
Prior: `docs/specs/public-google-auth/sa-validation-1.md` (CHANGES_REQUESTED, 4 points)
Reviewer: senior solutions architect (design gate, pre-implementation)

## Summary

All four prior blocking points are resolved in the revision, and the resolutions are
correct against the real codebase — not merely textual. The app-layer design was already
sound; the revision closes the infra/security plumbing gaps that broke the deploy and
opened production to fake auth. I found no new blocking issues introduced by the changes.
One non-blocking nit (a tested helper the spec chose to re-implement inline) is noted.

Verdict: APPROVED.

## Prior findings — confirmation

### (1) Production fake-OAuth security hole — RESOLVED

The decision (lines 53-57) and step 4 (lines 140-146) now gate real-vs-fake on
`ENVIRONMENT`, not on secret presence. `fakeGoogleAuth` is returned ONLY for `local`/`e2e`;
production and any unknown value take the real-`arctic` branch and `makeGoogleAuth` returns
`null` (→ routes 503) when either Google secret is absent. The spec is explicit that
secret-presence gating (the Telegram pattern) is disallowed here and states why
(an unconfigured prod would otherwise mint a verified owner session for anyone). This
mirrors the existing fail-closed posture of the auth middleware
(`worker/middleware/auth.ts:57`, "any unrecognized ENVIRONMENT (fail closed)"). Correct
and complete.

### (2) CI never wires the Google secrets — RESOLVED

Step 11 (lines 268-277) adds a "Set Google worker secrets" deploy-prod step mirroring the
existing "Set Telegram worker secrets" step (verified at `deploy.yml:113-125`), pushing
both secrets onto the deployed worker via `wrangler secret put ... -c dist/news/wrangler.json`.
It also removes the now-dead `TF_VAR_google_client_id` / `TF_VAR_google_client_secret` /
`TF_VAR_custom_domain_zone_id` / `TF_VAR_workers_dev_subdomain` env entries (currently
present at `deploy.yml:19-22`). The spec correctly notes the interaction with Finding 1:
absent secrets now mean 503 (fail-closed), not fake-auth. Complete.

### (3) Terraform removal under-specified — RESOLVED

Step 9 (lines 235-252) now enumerates the exact final surface and verifies cleanly against
the real `iac/`:

- `main.tf` keep-list (terraform block + provider + `cloudflare_d1_database.prod`) and
  remove-list (the `locals` block, the Google IdP, both Access applications, the trailing
  NOTE) match the actual file (`iac/main.tf:34-37` locals, `:47-99` Access resources,
  `:101-105` NOTE). Removing both Access apps removes the only consumers of
  `local.custom_domain_active`, and removing the `locals` block removes `local.app_hostname`
  — so the matching `outputs.tf` removal of `app_hostname` (the only `local.app_hostname`
  reference, `outputs.tf:6-9`) is required and is specified.
- `variables.tf` keep-only `cloudflare_api_token` + `cloudflare_account_id`; the four
  removed variables match exactly the ones now only referenced by deleted locals/apps
  (`variables.tf:12-38`).
- Final surface ("2 variables, 1 D1 resource, 1 output") is internally consistent and
  leaves no dangling reference, so `terraform validate` in `pnpm check` passes.

### (4) Cron test seam not injectable — RESOLVED

Step 7 (lines 196-209) introduces `sendDueDigests(db, deps, appUrl, now)` as the
dependency-injected core (mirroring `sendDailyDigest(db, deps, ...)` at
`scheduled.ts:32-44`), with `runTelegramDigests(env, now)` reduced to a thin wrapper
`sendDueDigests(getDb(env), createDeps(env), env.APP_URL, now)`. The test plan
(lines 300-306) drives `sendDueDigests` directly with a counting `hn` and a recording
Telegram client — the load-bearing "frontPage called exactly once / zero when none due"
assertion is now expressible. This matches the existing injected-deps test pattern. Correct.

## New-issue scan (changes introduced by the revision)

- **Digest split** (`fetchFrontPage` / `curateForUser` / `runDigest` wrapper) is a faithful
  decomposition of the current `runDigest` (`worker/lib/digest.ts:125`); the route and the
  Telegram `/fetch` path keep `runDigest`'s signature, so behavior is preserved. Sound.
- **`scheduled.ts` rewrite** correctly deletes `runScheduledDigest` and the `amsterdamHour`
  import; grep confirms `amsterdamHour` is used only by `runScheduledDigest`
  (`scheduled.ts:18`) and its own test, so the spec's "remove from `time.ts` + tests if
  unused, verify with grep" is safe. `amsterdamDate` / `amsterdamMinuteOfDay` stay.
- **`index.ts` scheduled handler**: dropping the `runScheduledDigest` branch and the
  `TELEGRAM_CRON` const collapses the handler to the single `*/5` call
  (`index.ts:42-46`) — consistent with the `["*/5 * * * *"]`-only triggers change.
- **`run_worker_first`**: adding `/auth/*` matches the existing form
  (`wrangler.jsonc:10` lists `/api/*`, `/telegram/*`). Mounting `/auth` outside `/api`
  (no auth/deps middleware) matches the `/telegram` precedent (`index.ts:37`).
- **`AuthBindings`**: removing `ALLOWED_EMAILS` and adding `DB` is consistent; the existing
  middleware tests reference `ALLOWED_EMAILS` (`auth.test.ts:22,40,...`) and the spec's test
  plan (line 297) correctly calls for removing those `ALLOWED_EMAILS` 403 cases.
- **Google secrets as optional `Bindings`** (like `TELEGRAM_BOT_TOKEN`) is the right shape:
  declared optional in types, presence checked at the seam, fail-closed in prod.

No new blocking issue. The subrequest-ceiling / rate-limit deferral to backlog
(lines 222-225, 264-265) remains right-sized at tens of users.

## Non-blocking nit (implementer's discretion, not a spec change)

Step 7 specifies the due-query as an inline `or(eq(slot1,m), eq(slot2,m), eq(slot3,m))`
in SQL. A tested helper `dueSlot(row, minute)` already encodes exactly this predicate
(`worker/lib/telegram-bot.ts:69-71`, tested in `telegram-bot.test.ts:61`). Pushing the
filter into SQL (rather than fetching linked rows and filtering with `dueSlot`) is a
reasonable choice for the table scan, but it duplicates the slot-matching logic in a second
place. Either is acceptable; if the implementer keeps the SQL form, the two should be kept
mutually consistent. Not blocking, not a required change.

## Spec-change list

None required.

VERDICT: APPROVED
