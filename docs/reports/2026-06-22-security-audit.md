# Security Audit — News (public launch readiness)

- **Date:** 2026-06-22
- **Reviewer:** Security audit (pre-public-launch)
- **Commit:** `claude/upbeat-ritchie-s11oah` (HEAD `1ba428b`)
- **Scope:** The full application as it will be exposed publicly at
  `news.justwallage.nl` — the Cloudflare Worker (Hono API + Google OAuth +
  Telegram webhook + `*/5` cron), the React SPA, the D1 schema, the IaC, and the
  CI/CD secret handling.
- **Method:** Manual source review of all worker routes/middleware/libs, the
  shared Zod contracts, the DB schema, the SPA render paths, `wrangler.jsonc`,
  Terraform, and the GitHub Actions pipelines; `pnpm audit --prod` for known CVEs.

---

## 1. Executive summary

The application is well-built from a security standpoint. The authentication
design is sound (opaque session tokens stored only as SHA‑256 hashes, PKCE +
state OAuth, `email_verified` enforced), every trust boundary parses input with
Zod, all database access is parameterised through Drizzle (no SQL injection),
identity is resolved in exactly one place and every query is scoped by the
authenticated email (no IDOR found), and the environment gating fails closed.
No known-vulnerable dependencies were found.

The findings below are therefore mostly **hardening and abuse-control** items
rather than exploitable breaches. The single most important consideration for
_opening this to the public_ is **resource/cost abuse**: the app moved from a
private, Access-gated, single-allowed-email model to a fully public,
self-service one, and there are currently **no rate limits or abuse controls** in
front of the expensive Workers AI curation path or account creation.

### Findings at a glance

| #   | Severity   | Finding                                                                                       |
| --- | ---------- | --------------------------------------------------------------------------------------------- |
| 1   | **Medium** | No rate limiting / abuse controls on the expensive Workers AI curation (cost DoS)             |
| 2   | **Medium** | Missing HTTP security headers (CSP, frame-ancestors, nosniff, HSTS, Referrer-Policy)          |
| 3   | **Medium** | Untrusted external URL used as `href` / Telegram `href` without scheme validation or escaping |
| 4   | **Low**    | Telegram link code has only ~32 bits of entropy                                               |
| 5   | **Low**    | CSRF protection relies solely on `SameSite=Lax`; no Origin/Referer or token check             |
| 6   | **Low**    | Stale IaC docs claim a Cloudflare Access perimeter that no longer exists                      |
| 7   | **Low**    | Expired sessions and consumed link codes are never purged; no "log out everywhere"            |
| 8   | **Low**    | OAuth callback has no error handling around the token exchange (→ 500 + wasted call)          |
| 9   | **Low**    | No automated dependency / secret scanning gate in CI                                          |
| 10  | **Info**   | User email written to observability logs (PII)                                                |
| 11  | **Info**   | Ephemeral E2E workers are publicly reachable with a committed webhook secret                  |
| 12  | **Info**   | Preferences length cap not enforced on the Telegram `/set_preferences` path                   |

---

## 1a. Remediation status (resolved 2026-06-23)

All twelve findings were remediated on branch `claude/upbeat-ritchie-s11oah`.
Summary of what shipped:

| #   | Status   | Fix                                                                                                                                                               |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ✅ Fixed | Per-user 10-min cooldown on `POST /api/digest/run` (`DIGEST_COOLDOWN_SECONDS`, `digest_runs` table → 429 + `Retry-After`) **and** Cloudflare Turnstile on sign-in |
| 2   | ✅ Fixed | `public/_headers` CSP (incl. Turnstile origin) + HSTS/XFO/nosniff/Referrer/Permissions; `hono/secureHeaders` on the worker                                        |
| 3   | ✅ Fixed | `isHttpUrl` scheme guard at HN ingestion, the SPA `safeHref`, and the Telegram href (now escaped, incl. `"`)                                                      |
| 4   | ✅ Fixed | Link code widened to 8 random bytes (64 bits)                                                                                                                     |
| 5   | ✅ Fixed | `originGuard` middleware: cross-site Origin on unsafe methods → 403 (absent Origin allowed)                                                                       |
| 6   | ✅ Fixed | `iac/CLAUDE.md` rewritten — no Access perimeter, public OAuth model, Turnstile noted                                                                              |
| 7   | ✅ Fixed | Nightly (03:00 UTC) cron purge of expired sessions + link codes (`lib/maintenance.ts`)                                                                            |
| 8   | ✅ Fixed | try/catch around the token exchange → 400 instead of 500                                                                                                          |
| 9   | ✅ Fixed | `.github/dependabot.yml` (npm + github-actions, weekly)                                                                                                           |
| 10  | ✅ Fixed | Digest logs use a `user#<hash>` tag instead of the raw email                                                                                                      |
| 11  | ✅ Fixed | Per-run e2e webhook secret (sed-templated in CI); committed value kept for local/hermetic only                                                                    |
| 12  | ✅ Fixed | Preferences capped at `PREFERENCES_MAX_LENGTH` (1000) on both the web schema and the Telegram path                                                                |

Operational follow-ups still owned by the deployer (not code): set the
`TURNSTILE_*` GitHub secrets to activate the bot-gate, and configure a Workers AI
spend alert/cap in the Cloudflare dashboard as a cost backstop.

---

## 2. Architecture & trust boundaries

A single Cloudflare Worker serves both the static SPA and the Hono API.
Request authentication splits into three zones:

| Surface                           | Auth                                                              | Exposure                |
| --------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| `/api/*`                          | `session` cookie → `sessions` table (`worker/middleware/auth.ts`) | Public, authenticated   |
| `/auth/{login,callback,logout}`   | None — this is what _creates_ a session (`worker/routes/auth.ts`) | Public, unauthenticated |
| `/telegram/webhook`               | `X-Telegram-Bot-Api-Secret-Token` (constant-time, fail-closed)    | Public, secret-gated    |
| SPA static assets                 | None                                                              | Public                  |
| `*/5` cron → `runTelegramDigests` | N/A (platform-triggered)                                          | Internal                |

**Key architectural fact for the public launch:** there is **no Cloudflare
Access** in front of the Worker. `iac/main.tf:39-43` provisions only the prod D1
database and explicitly notes "there are no Access resources here." Anyone with
_any_ Google account can complete the OAuth flow and self-provision an account
and a feed — this is the intended design (see `CLAUDE.md`), but it means the
Worker's own logic is the _entire_ security perimeter. (Note the stale doc in
finding #6.)

---

## 3. Detailed findings

### 1. (Medium) No rate limiting or abuse controls on the Workers AI curation path

**Locations:** `worker/routes/digest.ts:12`, `worker/lib/digest.ts:195-318`,
`worker/lib/ai.ts:102-131`, `worker/routes/preferences.ts:26`.

The HN front-page _fetch_ is rate-limited to once per 5 minutes globally
(`RATE_LIMIT_MS`, `worker/lib/digest.ts:44`), but the **AI scoring is not**.
`POST /api/digest/run` re-evaluates every front-page candidate that has not yet
been judged at the current `pref_version`. Because `PUT /api/preferences` bumps
`pref_version` on every real text change (`worker/lib/digest.ts:87-111`), an
authenticated user can drive unbounded Llama‑70B inference:

```
loop: PUT /api/preferences {text: <new text each time}  // bumps version
      POST /api/digest/run                               // forces full re-score
```

Each iteration sends ~50 stories through Workers AI in 3 batches
(`BATCH_SIZE = 20`, `MAX_TOKENS = 4096`). With the app public and **account
creation unbounded** (no email allowlist, no `hd` hosted-domain restriction in
the OAuth scopes — `worker/lib/oauth.ts:31-35`), this is a financial
denial-of-service / surprise-bill vector against the Workers AI (Neurons) and D1
budgets. There is no per-user or per-IP throttle anywhere, and no Cloudflare
Rate Limiting / WAF / Turnstile configured in `iac/`.

**Impact:** Cost amplification / budget exhaustion; degraded service for
legitimate users. No data exposure.

**Recommendations (in priority order):**

- Add a **per-user cooldown** on `POST /api/digest/run` (e.g. reject if a run
  happened in the last N seconds — the 5-min HN cache already makes more frequent
  runs pointless). A small `lastRunAt` column or a KV/Durable Object counter
  works.
- Consider gating account creation: an **email allowlist** or a Google `hd`
  hosted-domain restriction if the audience is meant to be bounded; otherwise add
  **Cloudflare Turnstile** on `/auth/login` and **Cloudflare Rate Limiting rules**
  (definable in Terraform) on `/auth/*` and `/api/digest/run`.
- Set a **Workers AI / account spend alert or cap** in the Cloudflare dashboard
  as a backstop.

---

### 2. (Medium) Missing HTTP security headers

**Locations:** `worker/index.ts` (no header middleware); no `public/_headers`
file; no header config in `wrangler.jsonc` or `iac/`.

Neither the API nor the static SPA emits any of the standard hardening headers:

- **`Content-Security-Policy`** — no CSP, so any future HTML/script injection has
  no second line of defence.
- **`X-Frame-Options` / `frame-ancestors`** — the app can be framed → clickjacking.
- **`X-Content-Type-Options: nosniff`**.
- **`Referrer-Policy`** — outbound clicks to story URLs may leak the full
  referrer.
- **`Strict-Transport-Security`** — not asserted by the app (Cloudflare may add it
  at the edge, but it is not pinned in code/IaC).
- **`Permissions-Policy`**.

**Impact:** Clickjacking; weaker defence-in-depth against XSS; referrer leakage.

**Recommendation:** Add a small Hono response-header middleware (applies to API
and, via `not_found_handling` SPA responses, the document) and/or a
`public/_headers` file for the static assets. A reasonable starting CSP for this
SPA: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';
connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`.
Add `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, and `Strict-Transport-Security: max-age=63072000; includeSubDomains`.

---

### 3. (Medium) Untrusted story URL used as `href` without scheme validation

**Locations:** `worker/lib/hn.ts:17-24` (ingestion — no URL/scheme validation),
`shared/api.ts:18` (`url: z.string().nullable()` — no scheme check),
`src/components/StoryRow.tsx:14,22-35` (`href={target}`),
`worker/lib/telegram.ts:67-78` (`<a href="${storyLink(s)}">` — interpolated unescaped).

Story URLs are ingested verbatim from the Algolia HN API and validated only as
"some string." They then flow into two `href` sinks:

- **SPA:** `target = story.url ?? hnItemUrl(story.id)` is rendered as
  `<a href={target}>`. React does **not** block `javascript:`/`data:` URLs in
  `href` (it only warns), so a story whose URL began with `javascript:` would
  produce a clickable script-executing link — **stored XSS** in the app origin.
- **Telegram:** the URL is interpolated into `<a href="...">` for `parse_mode:
HTML` **without escaping the `"`**, while the title/author _are_ escaped
  (`escapeHtml`, `worker/lib/telegram.ts:52-57`). A URL containing `"` can break
  out of the attribute (Telegram's HTML mode will reject the malformed message,
  causing failed digest sends).

In practice Hacker News only accepts `http(s)` submission URLs, so this is
**defence-in-depth**: the app is currently relying entirely on an upstream's
validation for values it renders as links.

**Recommendation:** Validate the scheme at ingestion — restrict `url` to
`http`/`https` in `hn.ts` (drop or null out anything else), and/or tighten
`storySchema.url` to `z.url()` with a scheme allowlist. Additionally escape the
`href` value (and validate scheme) in `worker/lib/telegram.ts`.

---

### 4. (Low) Telegram link code has only ~32 bits of entropy

**Location:** `worker/lib/telegram-bot.ts:98-101` (`generateLinkCode` — 4 random
bytes → 8 hex chars), consumed in `handleStart` (`:192-225`), 15-minute TTL.

A valid `/start <code>` binds the _sender's_ chat to the account that minted the
code. Guessing **any** currently-pending code (across all users) lets an attacker
link **their own** Telegram chat to a victim's account, after which `/user`
discloses the victim's email (`:331-332`) and `/set_preferences`, `/fetch`,
`/cur_preferences`, `/disconnect` all operate on the victim's account.

32 bits with a 15-minute window and Telegram's per-sender message rate limits
makes brute force impractical today, but the entropy is low for a code whose
compromise yields account takeover of the Telegram surface.

**Recommendation:** Widen the code to ≥ 8 random bytes (16 hex chars / 64 bits).
The change is one line and has no UX cost (it is delivered via the `t.me`
deep link).

---

### 5. (Low) CSRF defence relies solely on `SameSite=Lax`

**Locations:** session cookie (`worker/routes/auth.ts:73-79`), flow cookies
(`:19-24`); no Origin/Referer check or CSRF token anywhere.

State-changing endpoints (`POST/PUT/DELETE /api/*`, `POST /auth/logout`) are
protected against CSRF only by `SameSite=Lax`. This is adequate for current
browsers, but there is no second layer. `POST /auth/logout` is the one
cross-site-reachable side effect (forced logout — low impact). All `/api/*`
mutations use non-GET methods with `Content-Type: application/json`, which
SameSite=Lax does not attach cross-site, so the practical risk is low.

**Recommendation:** As defence-in-depth, add an `Origin`/`Referer` allowlist
check (the app is single-origin) on state-changing requests, or set the session
cookie to `SameSite=Strict` if the OAuth redirect flow tolerates it (the flow
cookies must remain `Lax` so they survive the Google redirect — they correctly
are).

---

### 6. (Low) Stale IaC documentation claims a Cloudflare Access perimeter

**Location:** `iac/CLAUDE.md:3-4,18-23` vs `iac/main.tf` and the design in
`CLAUDE.md`.

`iac/CLAUDE.md` states Terraform owns "the Access application + Google IdP (the
ONLY place the allowed-email lives), and a path-scoped Access app that bypasses
Access for `/telegram/webhook`." **None of that exists** — `main.tf` provisions
only the D1 database and its own comment says so. A maintainer (or a future
audit) reasoning about the security posture from this doc would wrongly believe
there is an Access layer and an email allowlist gating the Worker. There is not.

**Impact:** Governance / misjudged posture, not a direct vulnerability — but a
stale security-relevant doc is itself a risk before a public launch.

**Recommendation:** Update `iac/CLAUDE.md` to describe the current public Google
OAuth + in-Worker session model and the fact that there is no Access perimeter
and no email allowlist.

---

### 7. (Low) No purge of expired sessions / consumed link codes; no global revoke

**Locations:** `worker/lib/session.ts:30-45` (expired rows ignored but never
deleted), `worker/lib/telegram-bot.ts:157-178` (codes cleared only when consumed).

Expired `sessions` rows accumulate forever (30-day TTL each), as do unconsumed
link codes. This is unbounded table growth, not a direct vulnerability. There is
also no "log out of all devices" / bulk session-revocation mechanism, which is a
useful control if a user suspects compromise.

**Recommendation:** Add a periodic cleanup (the `*/5` cron can opportunistically
`DELETE FROM sessions WHERE expires_at <= now`), and consider a
"revoke all sessions for this email" action.

---

### 8. (Low) OAuth callback lacks error handling around the token exchange

**Location:** `worker/routes/auth.ts:67` — `await auth.verifyCode(code, codeVerifier)`
is not wrapped in try/catch.

A request to `/auth/callback` with a matching `state` cookie/param but an invalid
`code` makes the Worker call Google's token endpoint; `arctic` throws, and with no
handler Hono returns a 500. An attacker who sets their own matching state can
trigger one outbound Google token request per call (a subrequest + a hit against
the app's Google client), and the user-facing failure is an opaque 500 rather
than a graceful error.

**Recommendation:** Wrap `verifyCode` in try/catch and return a 400 ("sign-in
failed, please retry"); this also tidies error UX.

---

### 9. (Low) No automated dependency / secret scanning in CI

`pnpm audit --prod` is currently clean, but nothing in the pipeline gates on it
and there is no secret-scanning step. For a public service this should be a
standing gate.

**Recommendation:** Add `pnpm audit` (or Dependabot/Renovate + GitHub Dependabot
alerts) and a secret-scanning step to the CI pipeline.

---

### 10. (Info) User email in observability logs

`observability` is enabled (`wrangler.jsonc:12-14`) and several `console.log`
lines include the user's email (e.g. `worker/lib/digest.ts:206-210,280`). Emails
are PII; logs are access-controlled in Cloudflare but this is worth a conscious
decision. Preference _text_ is not logged (only its length) — good.

**Recommendation:** Log a hashed/truncated user identifier instead of the raw
email if logs are broadly accessible.

---

### 11. (Info) Ephemeral E2E workers are public with a committed webhook secret

The E2E environment hardcodes `TELEGRAM_WEBHOOK_SECRET = "e2e-webhook-secret"`
(`wrangler.jsonc:49`) and the ephemeral worker is reachable at
`news-e2e-<run_id>.workers.dev` for the duration of a CI run. Anyone who knows
the committed secret could drive `/telegram/webhook` DB side effects against that
run's throwaway D1. Impact is negligible: the Telegram client is the no-op fake
(no bot token, so nothing is ever sent), the DB is disposable, and the worker is
torn down on completion. The test-auth bypass header path is gated by a **per-run
random `TEST_AUTH_TOKEN`** (`ephemeral-e2e.yml:57-62`) and the bypass branch only
runs under `ENVIRONMENT === "e2e"`, so it is **unreachable in production** — this
is the correct, fail-closed design.

**Recommendation:** Accept as-is, or generate the e2e webhook secret per run for
symmetry with `TEST_AUTH_TOKEN`.

---

### 12. (Info) Preferences length cap not enforced on the Telegram path

`PUT /api/preferences` caps text at 10,000 chars (`shared/api.ts:47-49`), but the
Telegram `/set_preferences` command calls `savePreferences` directly
(`worker/lib/telegram-bot.ts:227-237`) without that schema. In practice Telegram
caps a message at 4,096 chars, so the bot path is bounded anyway — noted only for
consistency.

---

## 4. What is done well (positive observations)

These are deliberate, correct security decisions worth preserving:

- **Session tokens** are 256-bit opaque randoms; only their **SHA‑256 hash** is
  stored, so a DB read never yields a usable cookie (`worker/lib/session.ts`,
  `db/schema.ts:81-85`). Cookie is `httpOnly`, `Secure`, `SameSite=Lax`,
  host-only (no `Domain`).
- **OAuth** uses PKCE + `state` in short-lived (`600s`) hardened cookies,
  enforces `email_verified`, and `arctic` validates the Google ID token
  (`worker/routes/auth.ts`, `worker/lib/oauth.ts`).
- **Fail-closed environment gating:** unknown `ENVIRONMENT` is treated as
  production for auth; the fake OAuth seam and the `X-Test-*` bypass exist **only**
  under `local`/`e2e` and are gated on `ENVIRONMENT`, not on secret presence — a
  misconfigured deploy can never mint a session from the fake
  (`worker/middleware/auth.ts`, `worker/lib/oauth.ts:62-80`).
- **No SQL injection:** all queries go through Drizzle with bound parameters;
  the only raw `sql` fragments are static `excluded.*` upsert references.
- **Strict input validation** with Zod at every boundary, including IANA
  timezone validation via `Intl.DateTimeFormat` (`shared/api.ts:69-81`) and
  integer story-id validation (`worker/routes/stories.ts:31-33`).
- **No IDOR:** identity comes only from `c.get("userEmail")` set by the single
  auth middleware; every read/write is scoped by `userEmail`, including the
  story-open endpoint.
- **No permissive CORS** is configured (same-origin only).
- **Telegram webhook** uses a constant-time secret comparison and fails closed;
  title/author are HTML-escaped before going into `parse_mode: HTML`.
- **Constant-time comparison** (`timingSafeEqual`) for all shared secrets.
- **React auto-escaping** for all text content; **no** `dangerouslySetInnerHTML`,
  `eval`, or `innerHTML` anywhere in the codebase.
- **Secrets hygiene:** no secrets committed; `.gitignore` covers `.dev.vars`,
  `.env*`, `.bootstrap.env`, tfstate; production secrets are pushed via
  `wrangler secret put` at deploy time.
- **No known-vulnerable dependencies** (`pnpm audit --prod`: clean).

---

## 5. Prioritised remediation roadmap

**Before opening to the public:**

1. Add abuse controls on the AI curation path — per-user cooldown on
   `POST /api/digest/run`, plus a Workers AI spend cap/alert (finding #1).
2. Decide and enforce the account model — allowlist / `hd` restriction, or
   Turnstile + Cloudflare Rate Limiting on `/auth/*` (finding #1).
3. Add the security headers / CSP (finding #2).
4. Validate story URL schemes at ingestion (finding #3).

**Soon after:** 5. Widen the Telegram link code to 64 bits (finding #4). 6. Add Origin/Referer checks on mutations (finding #5). 7. Fix the stale `iac/CLAUDE.md` (finding #6). 8. Session/code cleanup + global revoke; OAuth callback error handling (#7, #8).

**Ongoing:** 9. CI dependency + secret scanning (finding #9); review PII in logs (#10).

---

## 6. Methodology & coverage notes

This was a static source review of the whole repository plus a dependency CVE
scan. It did **not** include dynamic testing (DAST), a live penetration test
against the deployed worker, fuzzing of the AI/Telegram parsers, or a review of
the Cloudflare dashboard configuration (e.g. whether edge HSTS, WAF managed
rules, or bot management are enabled outside Terraform). Re-validate the
header/CSP and rate-limiting findings against the live edge configuration before
sign-off.
