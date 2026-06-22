# Public Google sign-in (replace Cloudflare Access) + multi-user Telegram digest

## Request (verbatim)

> My cloudflare account gauth setup now uses some kind of single gauth provider for
> multiple of my apps, however, is this the preferred setup for this app given that
> I'm going to open it up to the public soon? How should I setup the google auth for
> this?

Follow-up:

> Looks good. Also make sure that during the every 5 min triggers that check whether a
> user has their digest then, make sure to only query HN when at least 1 user has their
> digest then, and also, if any user has their digest then, only query HN once and then
> run the AI eval for all users (in parallel, promise.all or something like that). Also
> let me know how to setup the gauth in gcloud, do I need to create a different one? Or
> can it reuse the current one?

## Goal

Open the app to the public. Today the app is gated by **Cloudflare Access** (a Zero-Trust
allowlist of one email, `just@wallage.nl`); the Worker trusts the
`Cf-Access-Authenticated-User-Email` header. Access is a per-seat allowlist gate, wrong for
self-serve public signup. Move authentication **into the Worker**: it runs Google OAuth
itself, issues a server-side session, and anyone with a verified Google account can sign in
and get their own feed/preferences/digest (true multi-tenant). Email stays the identity key
(no data migration). Cloudflare Access comes off the front entirely.

Separately, replace the owner-only 06:20 web-digest cron with a multi-user Telegram digest:
the `*/5` heartbeat serves every user whose configured slot is due, querying HN at most once
per tick.

## Decisions (resolved during brainstorming + follow-up)

- **[user]** Public model = **true multi-tenant**: every visitor signs in with Google and
  gets their own feed, preferences, and digest.
- **[user]** Build = **thin OAuth library** (own sessions + D1). → use [`arctic`](https://arcticjs.dev).
- **[user]** Identity key = **email** (the verified Google email). No `users` table, no data
  migration; all existing `userEmail`-keyed tables keep working.
- **[user]** Cron = **delete the 06:20 web digest** (`runScheduledDigest` + the `20 4`/`20 5`
  triggers). The Telegram scheduled digest becomes the only scheduled path. A linked Telegram
  chat with a configured slot = opt-in to the scheduled digest.
- **[user]** During the `*/5` tick: only query HN when ≥1 user is due; if any are due, query
  HN **once**, then run the AI eval for all due users in **parallel** (`Promise.all`).
- **[AI]** Google OAuth client in GCloud = **new dedicated Web-application OAuth client** for
  this app (reuse of the Access-shared client is possible but couples lifecycles). Redirect
  URI `https://news.justwallage.nl/auth/callback` (+ `http://localhost:5173/auth/callback` if
  real local login is ever wanted). Client id/secret become Worker secrets.
- **[AI]** Sessions = opaque random token in an `HttpOnly; Secure; SameSite=Lax` cookie; the
  SHA-256 hash is the `sessions` table PK (a DB leak does not grant sessions). 30-day expiry.
- **[AI]** Local dev keeps the `DEV_USER_EMAIL` bypass and e2e keeps the `X-Test-User-Email`
  header bypass — neither needs Google credentials. The OAuth code-exchange seam is injected so
  the auth routes are unit-testable, but **gated on `ENVIRONMENT`, NOT on secret presence**: the
  fake is used ONLY when `ENVIRONMENT` is `local` or `e2e`; production (and any unknown value)
  always uses the real `arctic` client and **fails closed** (503) if the Google secrets are
  absent. Secret-presence gating (the Telegram pattern) would let an unconfigured production
  mint a verified owner session for anyone — explicitly disallowed here.
- **[AI]** `ALLOWED_EMAILS` is removed everywhere. The only gate is "signed in with a verified
  Google account." Sign-up is fully open (no waitlist).
- **[AI]** Out of scope (backlog note only): per-user rate limiting on `/api/digest/run`.

## How to set up the Google OAuth client (answer to the user)

You can reuse the existing Access-shared client by adding a redirect URI, but the recommended
path is a dedicated client:

1. Google Cloud Console → the project that owns your OAuth consent screen → **APIs & Services
   → Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URIs**: `https://news.justwallage.nl/auth/callback` (and optionally
   `http://localhost:5173/auth/callback`).
3. Ensure the **OAuth consent screen** is **External** + Published so any Google user can sign
   in (it is per-project and can stay shared with your other apps).
4. Copy the client ID + secret → set Worker secrets:
   `wrangler secret put GOOGLE_CLIENT_ID` and `wrangler secret put GOOGLE_CLIENT_SECRET`
   (production env). Document this in `docs/BOOTSTRAP.md`.

The old Cloudflare-Access Google IdP (and its Access apps) are removed from Terraform; the
Access-shared client keeps serving your _other_ apps untouched.

---

## Implementation

### 1. Dependency

`pnpm add arctic` (ESM, edge-native, no Node deps). Must survive `knip` (it is imported by the
real OAuth seam).

### 2. New `sessions` table + migration

`db/schema.ts`: add

```ts
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // SHA-256 hex of the cookie token
  userEmail: text("user_email").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});
export type SessionRow = typeof sessions.$inferSelect;
```

Generate the Drizzle migration into `db/migrations/` (the same generator the repo already
uses). Migrations are applied in tests via the `TEST_MIGRATIONS` binding, so the new table is
available to the workers test pool automatically.

### 3. `worker/lib/session.ts` (new)

Server-side session store. Cookie holds the raw token; DB stores its hash.

- `SESSION_COOKIE = "session"`, `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`.
- `createSession(db, userEmail, now): Promise<{ token: string; expiresAt: Date }>` — generate a
  random token (32 bytes hex via `crypto.getRandomValues`), insert a row keyed by its SHA-256
  hex, return the raw token + expiry.
- `lookupSession(db, token, now): Promise<string | null>` — hash the token, select by id,
  return `userEmail` iff the row exists and `expiresAt > now`, else null.
- `deleteSession(db, token): Promise<void>` — hash + delete by id.

Add a `sha256Hex(input: string): Promise<string>` helper to `worker/lib/crypto.ts` (alongside
`timingSafeEqual`), using `crypto.subtle.digest("SHA-256", ...)`.

### 4. `worker/lib/oauth.ts` (new) — injected Google seam

```ts
export interface GoogleClaims {
  email: string;
  emailVerified: boolean;
}
export interface GoogleAuth {
  createAuthUrl(state: string, codeVerifier: string): string;
  verifyCode(code: string, codeVerifier: string): Promise<GoogleClaims>;
}
export function makeRealGoogleAuth(
  clientId,
  clientSecret,
  redirectUri,
): GoogleAuth;
export const fakeGoogleAuth: GoogleAuth; // deterministic verified test user
```

- `makeRealGoogleAuth` wraps `new Google(...)` from `arctic`. `createAuthUrl` →
  `google.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]).toString()`.
  `verifyCode` → `validateAuthorizationCode` → `decodeIdToken(tokens.idToken())`, then parse the
  claims with a Zod schema (`{ email: z.string().email(), email_verified: z.boolean() }`) — **no
  `as` casts**; `decodeIdToken` returns `unknown`-ish, so it MUST be schema-parsed.
- `fakeGoogleAuth.createAuthUrl` returns a deterministic absolute string the test can assert;
  `verifyCode` resolves `{ email: "just@wallage.nl", emailVerified: true }`.
- `makeGoogleAuth(env, redirectUri): GoogleAuth | null` factory, **ENVIRONMENT-gated (security
  critical)**:
  - `env.ENVIRONMENT === "local" || env.ENVIRONMENT === "e2e"` → `fakeGoogleAuth`.
  - otherwise (production / unknown — fail closed): if both `GOOGLE_CLIENT_ID` and
    `GOOGLE_CLIENT_SECRET` are set → `makeRealGoogleAuth(...)`; if either is missing → `null`
    (the routes turn this into `503`). The fake is NEVER returned in production, so a misconfig
    cannot mint a session.

### 5. `worker/routes/auth.ts` (new) — mounted OUTSIDE `/api`

`redirectUri = ${c.env.APP_URL}/auth/callback`. State/verifier carried in short-lived
`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` cookies (`oauth_state`, `oauth_verifier`)
via `hono/cookie`. Both `/auth/login` and `/auth/callback` first build
`const auth = makeGoogleAuth(c.env, redirectUri); if (auth === null) return c.json({ error:
"auth not configured" }, 503);` — production with absent secrets fails closed.

- `GET /auth/login` — `generateState()` + `generateCodeVerifier()` (from `arctic`), set the two
  cookies, `302` redirect to `auth.createAuthUrl(state, verifier)`.
- `GET /auth/callback` — read `code` + `state` from query and `oauth_state`/`oauth_verifier`
  cookies; if state missing/mismatched → `400`. `auth.verifyCode(code, verifier)`; if
  `!emailVerified` → `403`. Else `createSession(db, claims.email, now)`, set the `session`
  cookie (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=TTL`), clear the two oauth cookies,
  `302` to `/`.
- `POST /auth/logout` — `deleteSession` for the current cookie token (if any), clear the
  `session` cookie, return `okSchema` (`{ ok: true }`).

Mount in `worker/index.ts`: `app.route("/auth", authRoutes);` (no auth/deps middleware, like
`/telegram`). Add `"/auth/*"` to `assets.run_worker_first` in `wrangler.jsonc` so it is not
served as the SPA.

### 6. `worker/middleware/auth.ts` — production branch rewrite

- Remove `ALLOWED_EMAILS` from `AuthBindings`; add the `DB` binding (needs `getDb`).
- `local` and `e2e` branches unchanged.
- production (and any unknown ENVIRONMENT, fail closed): read the `session` cookie; if absent →
  `401`; `lookupSession`; if null → `401`; else `c.set("userEmail", email)`.

### 7. Cron refactor — split `runDigest`, multi-user Telegram digest

In `worker/lib/digest.ts`, split the existing `runDigest` into two exported functions (so the
front page is fetched once and shared across users), keeping `/api/digest/run`'s behavior
identical:

- `fetchFrontPage(db, hn, now): Promise<StoryInput[]>` — the current candidate-resolution block
  (rate-limit reuse of the cached snapshot, else one `hn.frontPage()` + chunked `stories`
  upsert). Returns the candidates.
- `curateForUser(db, ai, candidates, prefsText, prefVersion, userEmail, now): Promise<DigestResult>`
  — the current per-user AI eval + `curations` recompute/upsert block.
- `runDigest(...)` keeps its signature but is now `fetchFrontPage` then `curateForUser` (route +
  `sendDailyDigest` /fetch path unchanged).

In `worker/lib/scheduled.ts`:

- **Delete** `runScheduledDigest` (and the now-unused `amsterdamHour` import; remove
  `amsterdamHour` from `time.ts` + its tests if nothing else uses it — verify with grep).
- Add an exported, **dependency-injected** core (mirrors `sendDailyDigest(db, deps, ...)`, so it
  is wireable with a counting `hn` fake in tests):
  `sendDueDigests(db, deps, appUrl, now): Promise<void>`:
  - `minute = amsterdamMinuteOfDay(now)`.
  - Query `telegram` rows that are **due**: `chatId IS NOT NULL AND (slot1 = :m OR slot2 = :m OR
slot3 = :m)` (`isNotNull` + `or(eq...)`; narrow `chatId` with a type-guard predicate so the
    `Promise.all` body sees `number`, **no `as`**).
  - If none due → return (no HN query).
  - `const candidates = await fetchFrontPage(db, deps.hn, now)` — exactly one HN fetch.
  - `await Promise.all(due.map(async (row) => { const prefs = await loadPreferences(db,
row.userEmail); await curateForUser(db, deps.ai, candidates, prefs.text, prefs.version,
row.userEmail, now); const feed = await loadFeed(db, row.userEmail); await
deps.telegram.sendMessage(row.chatId, formatDigestMessage(feed, appUrl)); }))`.
- `runTelegramDigests(env, now)` becomes a thin wrapper:
  `sendDueDigests(getDb(env), createDeps(env), env.APP_URL, now)`.
- `sendDailyDigest` stays (the Telegram `/fetch` command still re-runs a single-user digest).

In `worker/index.ts` `scheduled`: only the `*/5` cron remains — call
`runTelegramDigests(env, new Date(controller.scheduledTime))` (drop the `runScheduledDigest`
branch + the `TELEGRAM_CRON` const if no longer needed).

In `wrangler.jsonc` production `triggers.crons`: `["*/5 * * * *"]` only (drop `20 4`/`20 5`).
Remove `ALLOWED_EMAILS` from all three env `vars` blocks. Add `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` as production **secrets** (not in `vars`); declare them optional in
`worker/env.ts` `Bindings` (like `TELEGRAM_BOT_TOKEN`). Run `pnpm cf-typegen` after the
`wrangler.jsonc` change.

> Known limit (backlog, not in scope): the `*/5` due-query is now a small table scan instead of
> a single indexed owner read, and parallel per-user eval multiplies Workers-AI/D1 subrequests
> within one cron invocation (Workers Free caps subrequests at 50). Fine at tens of users; note
> it in `docs/backlog/`.

### 8. SPA — `src/components/AuthGate.tsx` + sign-out

- `denied` state: replace the "Cloudflare Access / Reload" card with a **"Sign in with Google"**
  card whose button navigates to `/auth/login` (`window.location.href = "/auth/login"`).
- Add a **Sign out** control in the app chrome (the natural existing spot — e.g. near the user
  email / header). It `POST`s `/auth/logout` (through `apiFetch` + `okSchema` + `jsonInit`) then
  `window.location.href = "/"`.

### 9. Terraform (`iac/`) — full removal, enumerated

Access is fully removed; the custom domain is already created by wrangler (not TF). `terraform
fmt`/`validate` run in `pnpm check`, so the removal must be complete — no dangling vars/locals.

- `main.tf` — keep ONLY: the `terraform {}` block (providers + R2 backend), `provider
"cloudflare"`, and `resource "cloudflare_d1_database" "prod"`. **Remove**: the `locals` block
  (`custom_domain_active`, `app_hostname`), `cloudflare_zero_trust_access_identity_provider.google`,
  `cloudflare_zero_trust_access_application.news`,
  `cloudflare_zero_trust_access_application.telegram_webhook`, and the trailing Access NOTE
  comment.
- `variables.tf` — keep ONLY `cloudflare_api_token` and `cloudflare_account_id`. **Remove**
  `workers_dev_subdomain`, `google_client_id`, `google_client_secret`, `custom_domain`,
  `custom_domain_zone_id` (all only referenced by the removed locals/apps).
- `outputs.tf` — keep `d1_database_id_prod` (CI templates it into `wrangler.jsonc`). **Remove**
  the `app_hostname` output (references the deleted local).
- Final `iac/` surface: 2 variables, 1 D1 resource, 1 output. (`iac/CLAUDE.md`: update if it
  describes the Access apps.)

### 10. Docs

- Root `CLAUDE.md`: update the auth description (in-app Google OAuth + sessions, not Access),
  drop the `ALLOWED_EMAILS` owner-cron line, note the single `*/5` Telegram digest cron.
- `worker/CLAUDE.md`: bindings table — remove `ALLOWED_EMAILS`, add `GOOGLE_CLIENT_ID`/
  `GOOGLE_CLIENT_SECRET` (prod-only secrets); update the auth-middleware description (session
  cookie → `sessions` lookup), the cron/`scheduled` section (no web digest; multi-user Telegram
  digest; one HN fetch per tick), and the `/auth/*` mount note.
- `docs/BOOTSTRAP.md`: the GCloud OAuth-client steps + `wrangler secret put` for the two Google
  secrets.
- `docs/backlog/`: add a note for per-user `/api/digest/run` rate limiting + the cron subrequest
  ceiling.
- `README.md`: update for the new public-auth capability (big change).

### 11. CI (`.github/workflows/deploy.yml`)

- **`terraform` job env**: remove `TF_VAR_workers_dev_subdomain`, `TF_VAR_google_client_id`,
  `TF_VAR_google_client_secret`, `TF_VAR_custom_domain_zone_id` (their TF vars are deleted).
  Keep `TF_VAR_cloudflare_api_token` + `TF_VAR_cloudflare_account_id`.
- **`deploy-prod` job**: add a "Set Google worker secrets" step **after** Deploy, mirroring the
  existing "Set Telegram worker secrets" step — `wrangler secret put GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET -c dist/news/wrangler.json` from the same-named GHA secrets (reusing the
  GHA secrets formerly fed to `TF_VAR_*`). Without this the worker deploys with no Google
  credentials and `/auth/*` returns 503 (correct fail-closed, but login is broken until set).

## Tests

`pnpm check` green + relevant coverage. New/changed logic:

**Unit (vitest workers pool, real workerd + D1):**

- `worker/lib/session.test.ts` — `createSession` stores a hashed row + returns a raw token;
  `lookupSession` returns the email for a valid token, `null` for unknown and for expired;
  `deleteSession` removes it.
- `worker/routes/auth.test.ts` (drives the mounted app with `fakeGoogleAuth`):
  - `GET /auth/login` → `302`, sets `oauth_state` + `oauth_verifier` cookies, `Location` is the
    fake auth URL.
  - `GET /auth/callback` with matching `state` cookie + `code` → creates a session row, sets the
    `session` cookie, `302` to `/`.
  - callback with mismatched/missing `state` → `400`, no session.
  - callback where the claim is unverified → `403`, no session (use a fake variant returning
    `emailVerified: false`).
  - `POST /auth/logout` with a session cookie → deletes the row, clears the cookie.
- `worker/middleware/auth.test.ts` (extend; remove the `ALLOWED_EMAILS` 403 cases): production
  branch — valid `session` cookie → `userEmail` set; missing cookie → `401`; expired/unknown
  session → `401`.
- `worker/lib/scheduled.test.ts` (extend; drive `sendDueDigests(db, deps, APP, now)` with an
  injected `hn` whose `frontPage` increments a counter + the recording Telegram client):
  - no user due at the minute → `frontPage` called **0** times, no sends, `stories` empty.
  - two users due (+ one not due) at the minute → `frontPage` called **exactly once**; both due
    users get `curations` + one Telegram message each; the not-due user gets neither.
  - keep "does nothing when the chat is not linked" (no due rows → no fetch).
  - keep the existing `sendDailyDigest` test.

**E2E (Playwright):**

- An **unauthenticated** visit (no test-auth headers) renders the "Sign in with Google" screen
  with a control pointing at `/auth/login`. (Existing fixtures inject auth; add one without it.)

## Out of scope / non-goals

- No `users` table / no migration off email as the identity key.
- No per-user `/api/digest/run` rate limiting (backlog).
- No sign-up gating / waitlist (fully open).
- Local + e2e auth bypasses are unchanged (no real Google in dev/CI).
