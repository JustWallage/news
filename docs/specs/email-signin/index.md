# Spec: Email sign-in (one-time code + magic link)

## Original request (verbatim)

> I want to enable new users to create an account with their email rather than
> only google account. How can I enable this? And/or shall I do this through the
> google idp I've already setup?

## Answer to the "via Google IdP?" question

No. The Google IdP only authenticates **Google** accounts — it proves the user
controls a given Google account. It cannot verify ownership of an arbitrary
email (a custom-domain or non-Google mailbox), so it cannot be the basis for
"sign up with any email." This feature therefore adds an **independent
email-verification flow alongside** the existing Google button — Google sign-in
stays exactly as it is. This is purely additive.

The codebase already makes this clean: identity is **email-only** (there is no
`users` table; `createSession(db, email, now)` mints a session for any email
string, and all per-user data is keyed by `userEmail`). So a verified email is
all that is needed to "create an account" — first sign-in implicitly creates it,
identical to how Google sign-in works today.

## Decisions (all resolved)

- **[user]** Verify ownership with a **6-digit one-time code emailed to the
  address**. The email ALSO contains a clickable link carrying the code in URL
  params; opening it lands on the SPA, which **autofills the code and submits
  immediately** (feels like a magic link). One mechanism (the code), two ways to
  complete it (type it, or click the link).
- **[user]** Send verification emails via **Cloudflare Email Service** (Workers
  `send_email` binding — no third-party API key).
- **[AI]** Magic link targets the **SPA** (`/?login_email=…&login_code=…`), not a
  server route, because the user explicitly asked for the code to be _autofilled_
  in the input and then submitted. The SPA reads the params, fills the code
  field, auto-submits the verify request, then clears the params from the URL via
  `history.replaceState` (so the code is not left in the address bar / shared
  history). Trade-off vs. a server-side GET-and-redirect: the code briefly
  appears in the SPA URL; mitigated by short TTL + single-use + param scrubbing.
- **[AI]** OTP is **6 numeric digits**, **10-minute TTL**, **single-use**, with a
  **5-attempt cap** per issued code and a **60-second resend cooldown** per email.
  These bound brute-force (10^6 space × ≤5 guesses) and email-bombing.
- **[AI]** Reuse the existing **Turnstile bot-gate** on the request endpoint
  (same `verifyTurnstile` seam the Google login uses; no-op in local/e2e and when
  unconfigured in prod).
- **[AI]** Follow the established **fake-seam pattern** (mirroring `oauth.ts` /
  `turnstile.ts`): a `makeEmailSender(env)` returns a real sender in production
  and a no-op fake in local/e2e (gated on `ENVIRONMENT`, never reachable in
  prod). Production fails **closed** (503) if the email sender is unconfigured,
  exactly like `makeGoogleAuth` returns `null` → 503 when secrets are absent.
- **[AI]** Store the code **hashed** (`sha256Hex(`${email}:${code}`)`), mirroring
  how session tokens are stored as hashes — a DB read alone never yields a usable
  code. Constant-time compare via the existing `timingSafeEqual`.
- **[AI]** Normalize the email to **trimmed + lowercased** for the OTP path so
  identity is stable (`User@x.com` and `user@x.com` are the same account).
- **[AI]** In **local/e2e only**, the request endpoint returns the plaintext code
  as `devCode` in its JSON response (the email fake delivers nothing, so this is
  how `pnpm dev` and the hermetic e2e suite learn the code). This is gated on
  `ENVIRONMENT === "local" | "e2e"` and is **absent in production** — same
  philosophy as the OAuth/Turnstile fake seams. Documented as a prod-only-absent
  invariant.

## Context: how auth works today (for the implementer)

- `worker/routes/auth.ts` — `/auth/config`, `/auth/login` (Google + Turnstile),
  `/auth/callback` (creates session), `/auth/logout`. Mounted at `/auth`
  (`worker/index.ts`), **outside** `/api`, so it is reachable without a session.
- `worker/lib/session.ts` — `createSession`, `lookupSession`, `deleteSession`,
  `SESSION_COOKIE` (`"__Host-session"`), `SESSION_TTL_MS` (30d). The `__Host-`
  prefix REQUIRES the cookie be set with `secure: true`, `path: "/"`, and **no**
  `Domain` (Hono throws otherwise) — the verify route must set the session cookie
  with exactly the options `/auth/callback` uses.
- `worker/lib/oauth.ts` — the **fake-seam reference**: `makeGoogleAuth(env, …)`
  returns a deterministic fake in local/e2e and a real client (or `null` →
  fail-closed) in prod.
- `worker/lib/turnstile.ts` — `verifyTurnstile(env, token)`; returns true in
  local/e2e, no-op when secret unset in prod.
- `worker/lib/crypto.ts` — `sha256Hex`, `timingSafeEqual`.
- `worker/lib/rate-limit.ts` + `worker/routes/digest.ts` — the **rate-limit
  pattern reference** (per-user cooldown stored as a timestamp, 429 +
  `Retry-After`).
- `worker/lib/maintenance.ts` — `purgeExpired` runs daily on the 03:00 UTC cron
  tick; deletes expired sessions and clears stale Telegram link codes. New
  expiring rows must be purged here too.
- `db/schema.ts` — Drizzle schema; `sessions` table is the model to mirror for a
  hashed, expiring credential.
- `shared/api.ts` — Zod schemas are THE API contracts; add new request/response
  schemas here (never redefine locally).
- `src/components/LandingPage.tsx` — the unauthenticated screen; its `SignInCta`
  renders the Google button / Turnstile widget. `src/components/AuthGate.tsx`
  checks `/api/health` and renders `<LandingPage />` on 401. (The sign-in UI
  moved out of `AuthGate` into `LandingPage` — add the email form there.)
- `wrangler.jsonc` — bindings/vars per env. Bindings are **not** inherited by
  named envs; declare per env where needed (note how `ai` is declared in
  top-level + production but omitted in e2e).
- `worker/env.ts` — `Bindings` type widens/optionalizes secrets that cf-typegen
  can't model; add new optional bindings here.

## Requirements

### Data model

Add a Drizzle table in `db/schema.ts` and generate the migration with
`pnpm migrate:gen` (do **not** hand-write migration SQL):

```
email_login_codes:
  email        text       primary key        -- normalized (trim + lowercase)
  code_hash    text       not null            -- sha256Hex(`${email}:${code}`)
  expires_at   integer    not null  (timestamp)
  attempts     integer    not null  default 0 -- wrong-guess counter
  last_sent_at integer    not null  (timestamp) -- resend-cooldown anchor
```

One row per email; re-requesting **upserts** (new hash, new expiry, `attempts`
reset to 0, `last_sent_at` updated). Export `EmailLoginCodeRow` inferred type if
needed by lib code.

### OTP library — `worker/lib/email-login.ts`

Pure D1 logic, no env branching (mirror `rate-limit.ts`). Constants exported:
`OTP_TTL_MS = 10 * 60 * 1000`, `OTP_MAX_ATTEMPTS = 5`,
`OTP_RESEND_COOLDOWN_MS = 60 * 1000`, `OTP_LENGTH = 6`.

- `generateOtp(): string` — cryptographically random 6-digit string
  (`crypto.getRandomValues`; zero-padded; uniform — avoid modulo bias).
- `requestCode(db, email, now): Promise<{ code: string } | { retryAfterMs: number }>`
  — if a non-expired row exists and `now - last_sent_at < OTP_RESEND_COOLDOWN_MS`,
  return `{ retryAfterMs }` (throttle). Otherwise generate a code, upsert the row
  (hash, `expires_at = now + OTP_TTL_MS`, `attempts = 0`, `last_sent_at = now`),
  return `{ code }`.
- `verifyCode(db, email, code, now): Promise<boolean>` — load row; if missing or
  `expires_at <= now` → false. If `attempts >= OTP_MAX_ATTEMPTS` → delete row,
  false. Constant-time compare `sha256Hex(`${email}:${code}`)` against
  `code_hash`. On match → delete row, return true. On mismatch → increment
  `attempts`, return false.
- `purgeExpiredCodes(db, now)` — delete rows past `expires_at` (called from
  maintenance).

Email normalization helper (trim + lowercase) lives wherever the route can reuse
it; apply it before every table access so request and verify agree.

### Email sender seam — `worker/lib/email.ts`

Mirror `oauth.ts`:

```ts
export interface EmailSender {
  sendLoginCode(to: string, code: string, link: string): Promise<void>;
}
export function makeEmailSender(env: Bindings): EmailSender | null;
```

- local/e2e (`ENVIRONMENT === "local" | "e2e"`) → a **fake** no-op sender (never
  touches `env.EMAIL`).
- production / unknown env → real sender using the Workers binding:
  `env.EMAIL.send({ to, from: { email: env.EMAIL_FROM, name: "News" }, subject,
html, text })`. Include **both** `html` and `text`. The email body shows the
  6-digit code prominently AND a clickable link
  `${env.APP_URL}/?login_email=<enc>&login_code=<code>`.
- Returns `null` (→ route emits 503, fail-closed) in production when `EMAIL_FROM`
  is unset/empty. Never falls back to the fake outside local/e2e.

### Routes — extend `worker/routes/auth.ts`

Both POST, under `/auth` (public, outside `/api`); `originGuard` already covers
them app-wide.

- `POST /auth/email/request` — body `emailLoginRequestSchema`
  `{ email, turnstileToken?: string | null }`:
  1. `verifyTurnstile(c.env, turnstileToken ?? undefined)` → 403 on failure.
  2. `const sender = makeEmailSender(c.env)`; if `null` → 503.
  3. Normalize email. `requestCode(...)`. If `{ retryAfterMs }` → 429 +
     `Retry-After`.
  4. Build link, `sender.sendLoginCode(...)`.
  5. Respond `emailLoginRequestResultSchema` `{ ok: true }`, plus `devCode` ONLY
     when `ENVIRONMENT` is local/e2e.
  - Always return success-shaped 200 regardless of whether the address "exists"
    (every address is valid here — accounts are created on first verify — but do
    not leak send/throttle internals beyond the 429).
- `POST /auth/email/verify` — body `emailLoginVerifySchema` `{ email, code }`:
  1. Normalize email. `verifyCode(...)`. On false → 400
     `{ error: "Invalid or expired code" }` (do not distinguish reasons).
  2. On true → `createSession(getDb(c.env), email, new Date())`, set
     `SESSION_COOKIE` with the same cookie options as `/auth/callback`, respond
     `okSchema` `{ ok: true }`.

### Shared schemas — `shared/api.ts`

```ts
export const emailLoginRequestSchema = z.object({
  email: z.string().email(),
  turnstileToken: z.string().nullish(),
});
export const emailLoginRequestResultSchema = z.object({
  ok: z.literal(true),
  devCode: z.string().optional(), // present only in local/e2e
});
export const emailLoginVerifySchema = z.object({
  email: z.string().email(),
  code: z.string(),
});
// verify reuses okSchema
```

### SPA — `src/components/LandingPage.tsx`

Add a small two-step email form to the landing page's sign-in area, **alongside**
the existing Google `SignInCta`. Keep the landing-page copy/layout intact; the
email form sits with the Google button (e.g. an "or" divider under the hero CTA).

- Step 1 (email): email `<input>` + "Email me a code" button → POST
  `/auth/email/request` (include the Turnstile token when present; in local/e2e
  the response's `devCode` is auto-filled into the code input). On success → step 2.
- Step 2 (code): 6-digit `<input>` + "Sign in" button → POST
  `/auth/email/verify`. On success → re-check `/api/health` (or `location.reload`)
  so `AuthGate` re-renders into the app. On 400 → inline error; allow retry / "use
  a different email".
- The Google button + Turnstile widget stay as-is. When Turnstile is configured,
  obtain the token once and require it for the email-request submit too (gate both
  paths on it); when unconfigured (local/e2e), no token is needed.
- **Magic link**: on mount, read `login_email` + `login_code` from
  `window.location.search`. If both present → show step 2, prefill the code field,
  auto-submit the verify request, and `history.replaceState` to strip the params
  from the URL regardless of outcome.
- Use the existing UI primitives: `Button` and `Input` (`src/components/ui/`).
  `apiFetch` + `jsonInit` (`src/lib/api.ts`) are the fetch helpers; POSTs are
  same-origin so the session cookie is set on the verify response. Keep the
  Turnstile/CTA logic colocated — a small extra component in this file is fine.

### Config

- `wrangler.jsonc`: add `"send_email": [{ "name": "EMAIL" }]` to the **top-level**
  (local) config and the **production** env; **omit** it in `e2e` (fake seam, as
  `ai` is omitted there). Add `EMAIL_FROM` to the **production** `vars`
  (e.g. `"news@justwallage.nl"` — operator must pick an address on a domain
  onboarded to Cloudflare Email Sending).
- Run `pnpm cf-typegen` after editing `wrangler.jsonc`.
- `worker/env.ts`: add `EMAIL_FROM?: string` to `Bindings` (production-only var,
  widened/optional like the other env-specific values). `EMAIL` (the
  `SendEmail` binding) comes from cf-typegen.
- `worker/lib/maintenance.ts`: call `purgeExpiredCodes(db, now)` inside
  `purgeExpired` so expired codes are reaped on the daily tick.

### Operational note (README / docs)

Document that Cloudflare Email Sending must be enabled for the `EMAIL_FROM`
domain (`wrangler email sending enable <domain>` + SPF/DKIM/DMARC DNS) before
email sign-in works in production. Keep it brief; this is a new capability worth
a README mention.

## Out of scope

- Email + password auth (explicitly not chosen).
- Account linking / merging across Google and email for the same address (same
  email string is already the same account — no extra work, but no special UI).
- Rate-limiting beyond the per-email resend cooldown + per-code attempt cap +
  Turnstile (no global IP limiter in this change).
- Changing the Google flow.

## Tests

### Unit (`vitest`, colocated `*.test.ts`)

- `worker/lib/email-login.test.ts`:
  - `generateOtp` returns a 6-digit string; spot-check distribution is not
    obviously biased (range check).
  - `requestCode` upserts and returns a code; a second immediate call within the
    cooldown returns `{ retryAfterMs > 0 }`; after the cooldown it issues a new
    code.
  - `verifyCode`: success deletes the row; wrong code increments `attempts` and
    fails; after `OTP_MAX_ATTEMPTS` the row is deleted and verify fails; expired
    code fails; correct-but-expired fails.
  - `purgeExpiredCodes` deletes only expired rows.
- `worker/lib/email.test.ts`: `makeEmailSender` returns the fake in local/e2e and
  `null` in production when `EMAIL_FROM` is absent; returns a real sender when
  configured. (Do not perform a real send.)
- `worker/routes/auth.test.ts` (mirror the Google-callback test at
  `worker/routes/auth.test.ts:50-61`): this is where the **cookie round-trip** is
  proven. In a production-mode harness, request → verify with the right code →
  assert a `Set-Cookie` for `SESSION_COOKIE` is returned AND a `sessions` row
  exists for the email (i.e. `createSession` ran). Also: wrong code → 400 + no
  session; resend within cooldown → 429 + `Retry-After`; request when sender
  unconfigured (prod env, `EMAIL_FROM` absent) → 503; Turnstile failure → 403.
- `worker/lib/maintenance.test.ts`: purge clears expired email codes too.

> **Why the cookie round-trip is unit-level, not e2e:** in the `e2e` environment
> `/api/*` identity comes from the `X-Test-User-Email` test header
> (`worker/middleware/auth.ts`; `e2e/fixtures.ts:12-17`), **not** the session
> cookie. The cookie minted by `/auth/email/verify` is only consulted in
> production. So an e2e test cannot honestly assert "feed loads after verify" —
> the cookie is ignored there. The verify→cookie→session correctness therefore
> lives in the unit test above (production mode), and e2e asserts only
> client-observable UI behavior.

### E2E (`playwright`, `e2e/`)

The sign-in UI is only reachable via the **bare `test`** (no auth fixture) —
fixtures inject `X-Test-User-Email`, which makes `/api/health` succeed and
suppresses the sign-in screen. These specs assert client-observable behavior, not
session establishment:

- **Email request → code step**: open sign-in (bare) → enter email → submit "Email
  me a code" → assert the request returns ok, the code-entry step is shown, and
  the code input is **autofilled** from the `devCode` field (present only in the
  e2e env).
- **Magic link autofill**: navigate to `/?login_email=…&login_code=…` → assert the
  code field is prefilled, the verify request fires automatically, and the URL
  query params are **scrubbed** (`history.replaceState`).
- **Wrong code**: submit an incorrect code → assert an inline error is shown and
  the sign-in screen remains.

(End-to-end "land on the feed after verify" is intentionally NOT an e2e
assertion, per the note above — it is covered by the unit cookie round-trip.)

## Verification gate

`pnpm -F` package checks for touched packages, then root `pnpm check` green, plus
the new e2e specs passing (`pnpm test:e2e`). No `as` casts (use `shared/`
schemas); no unused exports (knip); update `wrangler.jsonc` → `pnpm cf-typegen`.
