# SA validation 2: Email sign-in (one-time code + magic link)

Spec: `docs/specs/email-signin/index.md`
Reviewer: senior solutions architect (design gate, no code)
Scope: re-validation after the Tests section was revised to resolve the two
test-plan changes requested in `sa-validation-1.md`.

## Summary

The single blocking issue from the first pass — Playwright e2e specs asserting
"land on the feed" in an environment where `/api/*` identity comes from test
headers, not the verify cookie — is fully resolved. The revised spec:

- Moves the **cookie / `createSession` round-trip proof to the unit level**
  (`worker/routes/auth.test.ts`, production-mode harness, asserting `Set-Cookie`
  for `SESSION_COOKIE` + a `sessions` row), explicitly mirroring the existing
  Google-callback test (`worker/routes/auth.test.ts:50-61`).
- Reframes the e2e specs to assert **only client-observable behavior** (step-2
  shown, code autofilled from `devCode`, magic-link param scrub, inline error on
  wrong code) and explicitly removes the feed-landing assertion with an inline
  rationale.
- Adds the requested clarity note that the new sign-in UI is reachable in
  Playwright only via the **bare `test`** (not `./fixtures`), because fixture
  headers auto-authenticate `/api/health` and suppress the sign-in screen.

Both `sa-validation-1` spec-change items are addressed, and I re-verified the
underlying mechanics against the real code: the production-mode `app.request`
harness pattern already exists, the bare-`test` 401-renders-sign-in pattern
already exists, and all referenced SPA/schema primitives exist. The rest of the
design (data model, OTP lib, email seam, routes, schemas, config) was approved
as-is in pass 1 and is unchanged. No blocking issues remain.

## Verification of the revised test plan against real code

- **Production-mode unit harness is feasible.** `worker/middleware/auth.test.ts:33`
  already builds a synthetic `{ ENVIRONMENT: "production", DB: env.DB }` env and
  passes it as the third arg to `app.request(...)`; `app.request` accepts a
  per-call env override. The vitest pool loads the `e2e` wrangler env
  (`vitest.workers.config.ts:15`) but tests override `ENVIRONMENT` per request.
  The spec's "production-mode harness" for the cookie round-trip is therefore a
  proven pattern, not a new capability.
- **The verify-route prod test does not need the email sender.** `/auth/email/verify`
  calls `verifyCode` + `createSession` only — it never touches `makeEmailSender`.
  So a prod-mode verify test works even though the e2e-loaded pool omits the
  `EMAIL` binding. Confirmed against the spec's route definition (lines 177-182)
  and `worker/middleware/auth.ts` (cookie consulted in prod).
- **Bare-`test` reachability is real.** `e2e/auth.spec.ts:1-12` uses the bare
  Playwright `test`, gets a 401, and asserts the sign-in screen renders — exactly
  the precondition the revised e2e specs depend on. `e2e/fixtures.ts:12-17`
  injects `X-Test-User-Email` + `X-Test-Auth` on every request, which would
  suppress the screen; the spec's note (lines 292-295) correctly steers the
  implementer to the bare `test`.
- **Referenced primitives exist.** `okSchema` (`shared/api.ts:19`),
  `src/components/ui/input.tsx`, `apiFetch` (`src/lib/api.ts:13`).

## Findings per axis

### Soundness

Unchanged from pass 1 and still sound. The revised tests do not alter the
runtime design; they only relocate where each property is proven. The cookie
round-trip is now proven where it can be proven honestly (prod-mode unit), and
the client UX is proven where it is observable (e2e). This is the correct split
given `worker/middleware/auth.ts`'s env-switched identity source.

### Right-sizing

Right-sized. The test plan proves each behavior exactly once at the cheapest
honest level: pure D1 state-machine in `email-login.test.ts`, seam selection in
`email.test.ts`, HTTP contract + cookie/session side-effect in the prod-mode
route test, purge in `maintenance.test.ts`, and only client-observable UX in
e2e. No redundant or theatrical coverage; no missing material behavior.

### Codebase fit

Strong. The revised unit test explicitly mirrors `worker/routes/auth.test.ts`
(the Google-callback `Set-Cookie` + sessions-row assertion), and the e2e specs
mirror `e2e/auth.spec.ts`'s bare-`test` convention. The plan respects the
project's established testing seams rather than inventing new ones.

### Risk / gaps

No blocking gaps. Two non-blocking implementation notes (latitude items, not
spec defects):

1. **Seeding a valid code in the prod-mode "request → verify" test.** Under the
   pool's e2e-loaded env with `ENVIRONMENT` overridden to `production`, the
   `EMAIL` binding is absent, so `makeEmailSender` returns `null` and the
   _request_ route would 503 before issuing a code — and `devCode` is absent in
   prod. The implementer must obtain the code either by calling `requestCode(db,
…)` directly to seed the row, or by injecting an `EMAIL` + `EMAIL_FROM` into
   the synthetic env so the request route succeeds. Both are trivial and the
   harness supports them; this is normal implementer latitude. The dedicated
   "sender unconfigured → 503" case naturally uses the no-`EMAIL` prod env as-is.

2. **Deliverability dependency (carried over).** Cloudflare Email Sending
   requires the `EMAIL_FROM` domain onboarded (SPF/DKIM/DMARC). The spec's
   operational note (lines 239-244) covers it. No design change.

## Open questions

None material. The one open question from pass 1 (how e2e asserts success
without the cookie path) is now answered in the spec itself.

## Spec-change list

None required. Both `sa-validation-1` change items are satisfied; the two risk
notes above are non-blocking implementer guidance, not spec edits. Do not
manufacture further changes — the design is sound, right-sized, and fits.

VERDICT: APPROVED
