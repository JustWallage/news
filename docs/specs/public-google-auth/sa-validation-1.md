# SA Validation — Public Google sign-in + multi-user Telegram digest

Spec: `docs/specs/public-google-auth/index.md`
Reviewer: senior solutions architect (design gate, pre-implementation)

## Summary

The spec is well-shaped and almost entirely correct against the real codebase. It correctly
identifies the auth seam (the single `authMiddleware` production branch), reuses the existing
DI pattern (`createDeps` token-branch) for the OAuth seam, and the digest refactor
(`fetchFrontPage` / `curateForUser`) is a clean split of the existing `runDigest` body that
preserves the rate-limit/version-reuse invariants. Session design (opaque cookie token, SHA-256
hash as PK, HttpOnly/Secure/SameSite=Lax) is sound and matches `worker/lib/crypto.ts`
conventions. The cron consolidation to a single `*/5` trigger with one HN fetch per tick is
correct and the test plan (call-counter on `frontPage`) directly verifies the load-bearing
"query HN once" requirement.

It is right-sized: thin OAuth via `arctic` rather than a heavier framework, email stays the
identity key (no `users` table, no migration), and rate-limiting is explicitly deferred. No
over-engineering.

Three findings require resolution before implementation — all in the deployment/infra plumbing
(Terraform + CI), not the app logic. The app-side design is approvable as written; the infra
gaps are blocking because they will break the deploy pipeline and lock the owner out.

## Findings by axis

### Soundness (solves the problem, right shape)

Sound. The auth move into the Worker is the correct response to "open to the public" — Access
is a per-seat allowlist and cannot do self-serve. The OAuth flow (state + PKCE verifier in
short-lived cookies, code exchange, verified-email check, session issue) is standard and
correct. The digest split solves the "one HN fetch, parallel per-user eval" requirement
directly.

One soundness note on the OAuth flow, non-blocking but worth stating: the spec carries
`oauth_state` and `oauth_verifier` as separate `SameSite=Lax` cookies and validates state on
callback. This is correct CSRF protection for the OAuth leg. Good.

### Right-sizing

Correct. `arctic` is the minimal sound choice (the user explicitly chose "thin OAuth library").
Reusing email as identity avoids a migration. Deferring rate-limiting and the cron-subrequest
ceiling to backlog is the right call at tens of users. No manufactured scope.

### Codebase fit

Strong fit, with verified specifics:

- The OAuth seam mirroring the Telegram branch in `createDeps` (`worker/lib/deps.ts:24-28`) is
  the right pattern. Note: the spec proposes a standalone `makeGoogleAuth(env, redirectUri)`
  factory rather than threading it through `Deps`. That is acceptable because `/auth/*` is
  mounted outside `/api` and never sees the deps middleware (`worker/index.ts:20-22` only sets
  `deps` on `/api/*`). Keeping the Google seam out of `Deps` is fine and arguably cleaner.
- Adding `DB` to `AuthBindings` and calling `getDb` from the middleware is consistent with how
  `getDb(env)` is used everywhere else.
- `sha256Hex` alongside `timingSafeEqual` in `worker/lib/crypto.ts` fits; the digest helper is
  already used there.
- `run_worker_first` already lists `/api/*` and `/telegram/*` (`wrangler.jsonc`), so adding
  `/auth/*` is consistent. Note the spec says `"/auth/*"`; match the existing entries' form.
- The `sessions` table shape is consistent with the Drizzle conventions in `db/schema.ts`
  (timestamp mode integer, text PK).

### Risk / gaps

**FINDING 1 (blocking) — Terraform removal will break `terraform apply` state and the
production custom-domain wiring.** `iac/main.tf` is more entangled than the spec's step 9
implies:

- `local.custom_domain_active` and `local.app_hostname` are computed from `var.custom_domain` /
  `var.custom_domain_zone_id`. Removing the two Access applications removes the only consumers
  of `custom_domain_active`, but `outputs.tf` still exports `app_hostname` (used nowhere in CI
  per grep, but it is a declared output). The spec says "remove ... locals if they become
  unused" — after removing the Access apps, `custom_domain_active` becomes unused and
  `app_hostname` local is only referenced by the `app_hostname` output. Decide explicitly:
  drop the `app_hostname` output too, or keep the locals. The spec leaves this as "keep
  whatever the D1/domain resources still need," but the D1 resource needs none of it — so
  effectively all of `custom_domain`, `custom_domain_zone_id`, `workers_dev_subdomain`,
  `custom_domain_active`, `app_hostname`, and the `app_hostname` output become removable. The
  spec under-specifies this and a half-removal will fail `terraform validate` (unused
  variable is fine, but a dangling local/output reference is not). Recommend: explicitly
  enumerate that after this change `iac/` retains only the D1 database resource + its output,
  the cloudflare provider/backend, and `cloudflare_api_token`/`cloudflare_account_id`
  variables. Confirm `workers_dev_subdomain` / `custom_domain*` variables are also removed.

**FINDING 2 (blocking) — CI deploy pipeline still passes removed TF vars and never sets the new
Worker secrets.** `.github/workflows/deploy.yml` sets `TF_VAR_google_client_id`,
`TF_VAR_google_client_secret`, `TF_VAR_custom_domain_zone_id`, `TF_VAR_workers_dev_subdomain`
(lines 19-22). If the spec removes those variables from `variables.tf`, Terraform will warn
(unused `TF_VAR_*` is tolerated) but the intent is muddled. More importantly: the spec says set
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` via `wrangler secret put` and "document in BOOTSTRAP,"
but does NOT add a CI step to push them onto the deployed worker. The existing pattern for
prod secrets is the "Set Telegram worker secrets" step (deploy.yml:113-125). Without an
equivalent step, the production worker deploys with no Google credentials, `makeGoogleAuth`
falls back to `fakeGoogleAuth`, and **production auth silently accepts the fake test user
`just@wallage.nl` for anyone** — a security hole, not just a broken login. The spec must
either (a) add a CI step mirroring the Telegram one to `wrangler secret put` both Google
secrets, or (b) state these are set manually once and accept that a fresh deploy without them
is fake-auth. Given fake auth = open door, (a) is strongly recommended, plus the production
`makeGoogleAuth` fallback should arguably fail closed rather than fall back to fake when
`ENVIRONMENT === "production"`. See Finding 3.

**FINDING 3 (blocking) — fake-OAuth fallback in production is a security hole.** The spec's
`makeGoogleAuth(env)` returns `fakeGoogleAuth` whenever the Google secrets are absent
(mirroring the Telegram branch). For Telegram that is benign (bot stays disabled). For auth it
is the opposite: `fakeGoogleAuth.verifyCode` resolves a verified `just@wallage.nl`, so any
hit to `/auth/login` then `/auth/callback?code=fake` in an environment missing the secrets
mints a real session for the owner's account. Combined with Finding 2 (secrets not wired in
CI), the first production deploy is exploitable. Resolution: the production branch
(`ENVIRONMENT === "production"`, and any unknown value, fail-closed) must require real Google
credentials — if absent, `/auth/login`/`/auth/callback` should 500/refuse rather than use the
fake. Only `local`/`e2e` may use `fakeGoogleAuth`. This mirrors how the auth middleware itself
already fails closed on unknown ENVIRONMENT (`worker/middleware/auth.ts:57`). Make the gating
ENVIRONMENT-driven, not merely secret-presence-driven.

**Minor — `runTelegramDigests` signature change vs. tests.** Current
`runTelegramDigests(env, now)` builds deps internally via `createDeps(env)`
(`worker/lib/scheduled.ts:70`). The spec's rewrite references `deps.hn` / `deps.ai` /
`deps.telegram` inside the function but keeps the `(env, now)` signature, so `deps` must still
be `createDeps(env)` inside. The existing test (`worker/lib/scheduled.test.ts`) injects a
recording telegram + counting hn — confirm the test seam still works. Looking at the current
test, it appears to call `runTelegramDigests` against the real `env` and relies on... actually
the current scheduled test imports `recordingTelegram` and a custom `hn` but the production
`runTelegramDigests(env, now)` calls `createDeps(env)` internally, which in the test env
(`ENVIRONMENT === "e2e"`/test) returns fakes, not the recording client. The spec's test plan
("`hn.frontPage` wrapped in a call counter") implies an injectable seam that the current
function signature does not expose. The spec should state how the counter/recording client is
injected — either by adding a deps parameter to `runTelegramDigests` (cleanest, test-friendly,
matches `sendDailyDigest(db, deps, ...)`) or by asserting via the fake clients. This is a real
ambiguity in the test plan; flag for the implementer to resolve by giving `runTelegramDigests`
an injected `deps` parameter (consistent with `sendDailyDigest`).

**Minor — `meSchema` / sign-out.** `okSchema` exists (`shared/api.ts:12`) so the logout client
parse is fine. The sign-out control's home is `src/pages/PreferencesPage.tsx:187` (renders the
user email already) — a natural spot, consistent with the spec's "near the user email."

**Minor — `amsterdamHour` removal.** Spec says remove from `time.ts` + tests if unused after
deleting `runScheduledDigest`. Verified: `amsterdamHour` is only used by `runScheduledDigest`
(`scheduled.ts:18`). `amsterdamDate` is used elsewhere; `amsterdamMinuteOfDay` stays. Removal
is safe — confirm no e2e/other references (grep before deleting, as the spec says).

### Open questions

1. **Production fake-OAuth fallback (Finding 3).** Recommended answer: gate the real-vs-fake
   Google seam on `ENVIRONMENT` (real for production/unknown, fail-closed if secrets missing;
   fake only for local/e2e), not on secret presence alone.
2. **CI secret wiring (Finding 2).** Recommended answer: add a "Set Google worker secrets"
   step to `deploy.yml` mirroring the Telegram one, guarded on the GHA secrets being present.
3. **`runTelegramDigests` test seam (minor).** Recommended answer: add an injected `deps`
   parameter to `runTelegramDigests` so the scheduled test can pass a counting HN client +
   recording Telegram client, consistent with `sendDailyDigest`.
4. **Terraform residual locals/outputs (Finding 1).** Recommended answer: explicitly enumerate
   the final `iac/` surface (D1 + its output + provider/backend + the two cloudflare auth
   variables) and remove everything else, so `terraform validate` passes cleanly.

## Spec-change list (required before APPROVED)

1. Step 4 / Decision: make the real-vs-fake Google seam ENVIRONMENT-gated (fake only for
   `local`/`e2e`); production with missing Google secrets must fail closed, never fall back to
   `fakeGoogleAuth`.
2. Step 10 / new step: add a CI deploy step to `wrangler secret put GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` onto the deployed production worker (mirror deploy.yml:113-125), and
   remove the now-dead `TF_VAR_google_client_id` / `TF_VAR_google_client_secret` /
   `TF_VAR_custom_domain_zone_id` / `TF_VAR_workers_dev_subdomain` env entries from deploy.yml.
3. Step 9: enumerate the exact final `iac/` surface and remove the now-unused `custom_domain`,
   `custom_domain_zone_id`, `workers_dev_subdomain` variables, the `custom_domain_active` /
   `app_hostname` locals, and the `app_hostname` output (or justify keeping each).
4. Step 7 / Tests: give `runTelegramDigests` an injected `deps` parameter so the call-counter
   HN client + recording Telegram client can be injected, matching `sendDailyDigest`.

The app-layer design (sessions, oauth routes, middleware rewrite, digest split) is sound and
approvable; the four changes above are infra/security plumbing that would otherwise break the
deploy or open production to fake auth.

VERDICT: CHANGES_REQUESTED
