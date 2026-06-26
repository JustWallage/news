# SA validation: Email sign-in (one-time code + magic link)

Spec: `docs/specs/email-signin/index.md`
Reviewer: senior solutions architect (design gate, no code)

## Summary

The spec is well-shaped and overwhelmingly correct. It correctly reads the
codebase's email-only identity model, faithfully mirrors the established
fake-seam / fail-closed pattern (`oauth.ts`), the hashed-credential pattern
(`session.ts`), the rate-limit/cooldown pattern, and the maintenance-purge hook.
The data model, OTP library, email seam, route contracts, shared Zod schemas,
and wrangler/env changes all check out against real code. The `send_email`
binding call shape is valid against the generated runtime types (verified by
running `wrangler types` with the binding added).

There is **one blocking gap**: the proposed Playwright e2e tests assert
"land on the feed" after verify, but in the `e2e` environment `/api/*` identity
is resolved from test headers (`X-Test-User-Email`), **not** from the session
cookie that `/auth/email/verify` mints. Those e2e assertions cannot pass
honestly as written. The fix is small (reframe the e2e assertions; the
cookie round-trip is already provable at the unit level), so this is a
spec-change request, not a redesign.

## Findings per axis

### Soundness — solves the problem, right shape

Sound. The "via Google IdP?" answer is correct: Google OIDC only proves control
of a Google account, so a separate email-verification flow is the right call.
The single-mechanism / two-entry design (typed code OR magic link carrying the
same code) is coherent. Routing the magic link at the SPA (`/?login_email&login_code`)
rather than a server GET is a defensible, explicitly-reasoned trade-off given
the user's "autofill the code" requirement; the short-TTL + single-use + param
scrub mitigations are appropriate.

The verify route reuses `createSession(...)` with identical cookie options to
`/auth/callback` (verified at `worker/routes/auth.ts:96-103`), so the
authenticated session is identical to the Google path — exactly the additive
property claimed.

### Right-sizing

Right-sized, not over-built. The OTP bounds (6 digits, 10-min TTL, single-use,
5-attempt cap, 60s resend cooldown) are the minimum credible brute-force /
bombing defenses without inventing a global IP limiter (correctly listed out of
scope). One row per email with upsert is the simplest correct model and mirrors
`telegram` link-code semantics already in `schema.ts`. No cleverness, no
gold-plating. Reuses `verifyTurnstile`, `sha256Hex`, `timingSafeEqual`,
`createSession`, and the maintenance purge rather than reinventing any of them.

### Codebase fit

Strong fit, with the verified specifics:

- Fake-seam + fail-closed: `makeEmailSender` mirrors `makeGoogleAuth`
  (`worker/lib/oauth.ts:65-83`) exactly — fake in local/e2e, real-or-`null`
  (→ 503) in prod. Correct.
- Hashed credential: `sha256Hex(\`${email}:${code}\`)` mirrors the session-token
hash model (`db/schema.ts:78-85`, `worker/lib/session.ts`). Correct.
- `purgeExpired(db, now)` takes a `Db` and is the right hook
  (`worker/lib/maintenance.ts:15`); adding `purgeExpiredCodes(db, now)` there fits.
- `originGuard` (`worker/middleware/csrf.ts`) already covers app-wide POSTs; the
  new `/auth/email/*` POSTs are same-origin from the SPA, so the guard is
  satisfied. Correct.
- `wrangler types` generates `EMAIL?: SendEmail` and the `SendEmail` interface
  when `"send_email": [{ "name": "EMAIL" }]` is present (I verified this by a
  throwaway typegen run). The spec's claim that `EMAIL` "comes from cf-typegen"
  and only `EMAIL_FROM?` needs hand-adding to `worker/env.ts` is correct.
- The `env.EMAIL.send({ from, to, subject, text, html })` builder-object call
  shape matches the generated `SendEmail.send` overload (verified in the
  generated `worker-configuration.d.ts`). `from: { email, name }` matches the
  `EmailAddress` type. Correct — this was the highest-risk API assumption and it
  holds.
- Bindings are not inherited by named envs; the spec correctly declares
  `send_email` in top-level + production and omits it in e2e, paralleling how
  `ai` is handled (`wrangler.jsonc:19,70`).

### Risk / gaps

1. **BLOCKING — e2e auth model vs. the cookie.** `worker/middleware/auth.ts`
   resolves `/api/*` identity from `DEV_USER_EMAIL` (local) or the
   `X-Test-User-Email` + `X-Test-Auth` headers (e2e); the session cookie is only
   consulted in production/unknown env. The Playwright fixture
   (`e2e/fixtures.ts:12-17`) injects those headers on _every_ request. Therefore:
   - If the new e2e specs use the `./fixtures` `test`, `/api/health` succeeds via
     headers _before_ sign-in ever renders — the sign-in screen never appears, so
     the email flow can't be driven.
   - If they use the bare Playwright `test` (like `e2e/auth.spec.ts`), `/api/health`
     stays 401 even after a _successful_ verify, because the cookie is ignored in
     the e2e env — so "land on the feed" can never be reached.

   Either way the spec's e2e "Email happy path" and "Magic link" feed-landing
   assertions cannot pass honestly. The session-cookie round-trip is already
   provable at the unit level (see `e2e`-pool `worker/routes/auth.test.ts:50-61`,
   which asserts `Set-Cookie` + a sessions row on the Google callback). See
   spec-change list for the reframing.

2. **Non-blocking — real-world deliverability dependency.** Cloudflare Email
   Sending via the `send_email` binding requires the `EMAIL_FROM` domain to be
   onboarded (DKIM/SPF/DMARC). The spec's operational note covers this, but it is
   the actual gating dependency for the feature working in prod (not just a nicety).
   Worth keeping prominent. No design change needed.

3. **Non-blocking — `okSchema` reuse on verify.** Verify returns `okSchema`
   `{ ok: true }`, but the success side-effect is the `Set-Cookie`. The SPA must
   re-check `/api/health` (or reload) to re-render `AuthGate` — the spec says this.
   Fine; just confirming the SPA does not rely on a body field for the email it
   just signed in as (it gets that from the subsequent `/api/health`).

4. **Non-blocking — `devCode` autofill ordering in local.** In `pnpm dev`,
   `/api/*` uses `DEV_USER_EMAIL`, so `AuthGate` never shows sign-in locally
   either (same mechanism as finding 1). The email form is therefore primarily
   exercisable in local only by visiting it while unauthenticated is impossible
   under the dev-header model. This does not block the feature (production is the
   real target and unit tests cover the route), but the spec's implication that
   `pnpm dev` is a way to manually click through the email flow is shaky. Treat
   local manual testing as best-effort; rely on unit coverage.

No other failure modes of note. Modulo-bias avoidance, constant-time compare,
single-use delete-on-success, attempt-cap delete, and expiry checks are all
specified correctly and match the `verifyCode` state machine described.

## Open questions (with recommended answers)

1. **How should the e2e specs assert success without the cookie path being
   live in the e2e env?**
   Recommended: assert observable _client_ behavior instead of feed-landing:
   the request transitions to step 2, the code field is autofilled from
   `devCode` (or magic-link param), the verify POST returns 200, and the URL
   params are scrubbed via `history.replaceState`. Prove the cookie/session
   round-trip at the unit level (production-mode `app.request` asserting
   `Set-Cookie` + sessions row), exactly as `worker/routes/auth.test.ts` does for
   the Google callback. This keeps coverage honest and matches existing
   conventions.

2. **Should `EMAIL_FROM` use a name part (`{ email, name: "News" }`)?**
   Recommended: yes, as specified — it matches `EmailAddress` and improves
   deliverability/UX. No change.

## Spec-change list (required before APPROVED)

1. **Tests › E2E:** Replace the "land on the feed" assertions in the "Email
   happy path" and "Magic link" specs with client-observable assertions
   (step-2 shown, code autofilled, verify returns ok, URL params cleared), and
   explicitly state that the **session-cookie/`createSession` round-trip is
   verified at the unit level** (production-mode `app.request` asserting
   `Set-Cookie` + a `sessions` row, mirroring `worker/routes/auth.test.ts`).
   Reason: `/api/*` identity in the `e2e` env comes from test headers, not the
   cookie (`worker/middleware/auth.ts`), so feed-landing is unprovable there.

2. **Tests / Context (clarity):** Note that the new sign-in UI is only reachable
   in Playwright via the **bare** `test` (no `./fixtures` auth headers), since
   the fixture headers auto-authenticate `/api/health` and suppress the sign-in
   screen (`e2e/fixtures.ts`, `e2e/auth.spec.ts`). The implementer needs this to
   write a runnable spec.

Everything else in the spec is approved as-is; do not manufacture further
changes. Once the e2e assertion strategy is corrected, this is a clean,
right-sized, well-fitting design.

VERDICT: CHANGES_REQUESTED
