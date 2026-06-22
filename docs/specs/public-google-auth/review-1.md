# Review 1 — Public Google sign-in + multi-user Telegram digest

## Summary

The branch fully implements the spec: Cloudflare Access is removed end to end
(Terraform, CI, bootstrap, docs), authentication moves into the Worker via
`arctic` Google OAuth with opaque server-side sessions, and the cron is replaced
by a single `*/5` multi-user Telegram digest that queries HN at most once per
tick and curates for all due users in parallel. `pnpm check` is green (70 unit
tests pass) and the required e2e coverage is present. Every spec section (1–11)
landed, including the security-critical ENVIRONMENT-gated OAuth seam and the
fail-closed 503 behavior. The work is approvable; only one minor, non-blocking
observation below.

## Findings by axis

### Simplicity — clean

The split of `runDigest` into `fetchFrontPage` + `curateForUser`
(`worker/lib/digest.ts`) is the minimal change that lets the cron share one HN
fetch while keeping the single-user route/`/fetch` path identical. `sendDueDigests`
is a straightforward due-query → fetch-once → `Promise.all` curate/send. Session
store, oauth seam, and auth routes are all as small as the spec describes.

### Spec implementation — complete

- Dependency `arctic` added and exercised by the real seam (survives knip).
- `sessions` table + migration `0003_special_scrambler.sql` match the spec shape.
- `worker/lib/session.ts`: token gen, SHA-256-keyed rows, TTL, lookup/delete as
  specified; `sha256Hex` added to `worker/lib/crypto.ts`.
- `worker/lib/oauth.ts`: `GoogleAuth` seam, `makeRealGoogleAuth`, `fakeGoogleAuth`,
  and the ENVIRONMENT-gated `makeGoogleAuth` returning `null` (→ 503) when prod
  secrets are absent. The `"unverified"` sentinel code exercises the 403 path.
- `worker/routes/auth.ts`: `/login`, `/callback`, `/logout` mounted outside `/api`
  (`worker/index.ts`), short-lived state/verifier cookies, fail-closed 503, state
  mismatch → 400, unverified → 403. `/auth/*` added to `run_worker_first`.
- `worker/middleware/auth.ts`: `ALLOWED_EMAILS` removed, `DB` added, production +
  unknown-environment branch resolves the `session` cookie via `lookupSession`.
- Cron refactor in `worker/lib/scheduled.ts` matches the spec body verbatim;
  `runScheduledDigest` and `amsterdamHour` deleted; `time.ts`/tests cleaned.
- `wrangler.jsonc`: crons `["*/5 * * * *"]` only, `ALLOWED_EMAILS` gone from all
  envs, Google secrets declared optional in `worker/env.ts`.
- Terraform reduced to exactly 2 vars / 1 D1 resource / 1 output; CI `terraform`
  job env trimmed and a "Set Google worker secrets" step added after Deploy.
- SPA: `AuthGate` "Sign in with Google" card → `/auth/login`; sign-out control in
  `PreferencesPage` POSTs `/auth/logout`. Docs (root + worker CLAUDE.md, BOOTSTRAP,
  README, backlog note) updated.

### No shortcuts — clean

No swallowed errors, stubs, or TODOs. `as` casts avoided; id-token claims are
Zod-parsed. The fake OAuth seam is gated on ENVIRONMENT (not secret presence),
exactly as the spec demands, so a misconfigured prod cannot mint a session.

### Code quality — clean

Conventions followed (Drizzle inference for row types, `getDb`, injected deps,
`okSchema.parse`). The `LinkedRow` type-guard narrows `chatId` to `number` with
no cast. Comments are sparse and explain non-obvious invariants only.

### Tests — clean

`session.test.ts` (store/lookup/expire/delete), `auth.test.ts` (login redirect +
cookies, valid callback creates session, mismatched state → 400, unverified →
403, logout deletes row), `auth.test.ts` middleware (prod valid/missing/unknown,
unknown-env fail-closed, e2e, local), and `scheduled.test.ts` (0 fetches when no
user due, exactly 1 fetch for two due users with the not-due user excluded,
unlinked chat). E2E adds an unauthenticated visit asserting the sign-in screen.

## Observations (non-blocking)

- `worker/lib/oauth.ts:18` — the id-token schema uses `z.string()` for `email`
  where the spec wrote `z.string().email()`. Not a security or correctness issue
  (the real gate is `email_verified`, and Google controls the token; the email is
  only used as the identity key), but it is a minor deviation from the spec text.
  Optional: tighten to `.email()` to match the spec, or leave as-is intentionally.
- Stale `ALLOWED_EMAILS`/`runScheduledDigest` mentions remain only in historical
  spec docs (`docs/specs/telegram-bot.md`, `docs/superpowers/specs/...`), which are
  prior design records, not authoritative. No action required.

## Action list

None required.

VERDICT: APPROVED
