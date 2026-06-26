# Review 1 — Email sign-in (one-time code + magic link)

## Summary

The branch implements email sign-in exactly as specified: an additive OTP flow
alongside the unchanged Google button. Data model, OTP library, email seam,
routes, shared schemas, SPA two-step form + magic link, config, maintenance
purge, and the full test matrix (unit + e2e) all match the spec. `pnpm check`
passes green (118 unit tests, exit 0). No `as` casts, no swallowed errors, no
stubs/TODOs. I recommend approval.

## Findings per axis

### Simplicity — clean

The implementation is the simplest correct shape. `email-login.ts` is pure D1
logic with no env branching (mirrors `rate-limit.ts`); the route owns Turnstile,
send, and session minting. `generateOtp` uses straightforward per-digit
rejection sampling (bytes >= 250 dropped) to avoid modulo bias — minimal and
correct. No speculative abstraction or unused exports (knip is part of the green
gate).

### Spec implementation — clean

Every requirement is present and faithful:

- Table `email_login_codes` matches the spec columns exactly
  (`db/schema.ts:93`), migration generated via tooling
  (`db/migrations/0006_volatile_sunspot.sql`), not hand-written.
- Constants, `generateOtp`, `requestCode`, `verifyCode`, `purgeExpiredCodes`,
  and `normalizeEmail` all match the spec contracts
  (`worker/lib/email-login.ts`). `verifyCode` honors the precise ordering:
  missing/expired -> false, attempts >= cap -> delete + false, constant-time
  compare, match -> delete + true, mismatch -> increment + false.
- Email seam mirrors `oauth.ts`: fake in local/e2e, real otherwise, `null`
  (fail-closed) when `EMAIL`/`EMAIL_FROM` absent; both `html` and `text` bodies
  with the code and the magic link (`worker/lib/email.ts`).
- Both routes implemented with the specified status codes (403/503/429/400/200)
  and the `devCode` gated on local/e2e (`worker/routes/auth.ts:123-181`). The
  verify route reuses the shared `sessionCookie` options, so the `__Host-`
  prefix constraints are satisfied identically to `/auth/callback`.
- Shared schemas added verbatim (`shared/api.ts:23-38`); verify reuses
  `okSchema`. (Uses `z.email()` rather than `z.string().email()` — this is the
  current Zod-v4 API already used throughout this file, e.g. line 60; not the
  literal spec text but the correct, in-convention form.)
- SPA two-step form + magic-link autofill/auto-submit/`replaceState` scrub,
  alongside the Google button with an "or" divider, Turnstile token gating both
  paths (`src/components/LandingPage.tsx`).
- Config: `send_email`/`EMAIL` declared top-level + production, omitted in e2e;
  `EMAIL_FROM` in production vars; `env.ts` widens `EMAIL_FROM?: string`
  (`wrangler.jsonc`, `worker/env.ts:50`). `cf-typegen` runs inside the green
  gate.
- `purgeExpiredCodes` wired into `purgeExpired` (`worker/lib/maintenance.ts:19`).
- README + `worker/CLAUDE.md` updated with the new capability and the
  prod-only-absent `devCode` invariant.

Nothing invented beyond scope; the Google flow is untouched.

### No shortcuts — clean

Production fails closed (503) when the sender is unconfigured. Codes are stored
only as a salted hash. Verify returns a single opaque 400 for all failure modes
(no reason leak). Request always returns success-shaped 200 except the 429
throttle, per spec. The `catch(() => null)` on `c.req.json()` feeds a schema
`safeParse` that returns a clean 400 — not a swallowed error. No TODOs, no
test-only routes, no logic gated on `isTest`.

### Code quality — clean

Comments explain non-obvious invariants (rejection-sampling rationale, fail-
closed seam, `__Host-` cookie constraints) and follow the repo's no-narration
rule. Types cross boundaries via `shared/` schemas and Drizzle inference; no
local redefinitions. `EmailLoginCodeRow` was not exported — correct, since the
spec said "if needed by lib code" and the lib relies on inferred select rows.

### Tests — clean

- `email-login.test.ts`: `generateOtp` range check, `requestCode` upsert +
  cooldown + post-cooldown reissue, `verifyCode` success/consume/replay, wrong-
  code increment, lockout-after-cap, expired, never-requested; `purgeExpiredCodes`
  selectivity.
- `email.test.ts`: fake in e2e, `null` in prod when `EMAIL` binding absent and
  when `EMAIL_FROM` empty.
- `auth.test.ts`: the cookie round-trip in a production-mode harness (verify ->
  `Set-Cookie` for `SESSION_COOKIE` + a `sessions` row under the normalized
  email + code consumed), wrong code -> 400 + no session, resend -> 429 +
  `Retry-After`, prod sender unconfigured -> 503. (Turnstile-failure 403 is not
  asserted at the route level — see action below.)
- `maintenance.test.ts`: expired email codes purged, live ones kept.
- `e2e/email-signin.spec.ts`: request -> code step with `devCode` autofill,
  magic-link prefill/auto-verify/URL scrub, wrong-code inline error — all via
  the bare `test`, matching the spec's reasoning about the e2e identity header.

## Notes (non-blocking)

- `pnpm check` emits wrangler WARNINGs that `send_email`/`ai` exist top-level but
  not in `env.e2e`. These are expected and explicitly directed by the spec
  (`ai` already did this pre-change); they are warnings, the gate exits 0.
- The spec's Turnstile-failure 403 unit assertion for `/auth/email/request` is
  not present. The route code is correct (`auth.ts:130-134`) and Turnstile is
  bypassed in the e2e test env, so asserting 403 would require a prod-mode
  Turnstile fake the harness does not have; the Google `/auth/login` path has no
  such assertion either. Optional to add, not required for correctness.

## Action list

None required.

VERDICT: APPROVED
