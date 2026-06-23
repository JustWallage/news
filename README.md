# news

A public, AI-curated Hacker News front page, hosted at `news.justwallage.nl` on
Cloudflare. Sign in with Google and get your own feed.

The Worker pulls the Hacker News front page (the Algolia HN API — one request,
full content) and filters it through Workers AI (Llama 70B) against your
plain-text preferences blob, storing the matches in D1. The site renders them
like the HN front page — title (link), points, age, comments — and tracks which
links you've opened. Curation runs on demand (the Refresh button / Telegram
`/fetch`) and on a `*/5` cron that pushes a Telegram summary at each user's
configured slot.

## Stack

Vite + React 19 SPA and a Hono API served by one Cloudflare Worker; in-app Google
OAuth sign-in (`arctic`) with D1-backed sessions; D1 (Drizzle) for storage;
Workers AI for filtering; Zod contracts in `shared/`; Terraform for infra (prod
D1, custom domain); Playwright e2e; a single `pnpm check` gate enforced as the
pre-commit hook.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars   # local identity + test token
pnpm dev                         # http://localhost:5173
pnpm check                       # format, lint, types, knip, jscpd, terraform, unit tests
pnpm test:e2e                    # Playwright
```

`pnpm dev` (local) hits the **real** Hacker News + Workers AI (so you can debug
the live pipeline); the Workers AI binding proxies to the real service, so run
`wrangler login` first. **e2e is hermetic** — it uses deterministic fakes (canned
stories + a keyword filter), no network or cost. Trigger a run with the Refresh
button or `await fetch("/api/digest/run", { method: "POST" })`.

## Pages

- **`/`** — your curated feed.
- **`/preferences`** — your signed-in identity, a Log out button, a big plain-text
  box describing what you want to read, and a Generate start command button for
  linking Telegram.

Unauthenticated visitors get a "Sign in with Google" screen.

## Telegram bot

Link a Telegram chat (Generate start command → send the bot `/start <code>`) to
manage the app from chat: `/set_preferences`, `/cur_preferences`, and up to three
`/daily_time HH:MM` slots. Each slot re-runs the digest and pushes the fresh
picks to the chat. Setup is in [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md).

## Security

Built to be opened to the public. Sessions are opaque random tokens stored only
as their SHA-256 hash; sign-in is Google OAuth (PKCE + state, `email_verified`
enforced) gated by Cloudflare Turnstile against bots. The on-demand feed refresh
is rate-limited per user to bound Workers AI cost. Responses carry a strict CSP
(`public/_headers`) plus HSTS, `X-Frame-Options`, nosniff and a referrer policy,
and state-changing requests are Origin-checked on top of the SameSite cookie. See
the audit in [docs/reports/](docs/reports/).

## Setup & deploy

One-time cloud setup is in [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md). Pushing to
`main` runs the full pipeline (checks → terraform → ephemeral E2E → deploy).
Future ideas live in [docs/BACKLOG.md](docs/BACKLOG.md); the authoritative
design is [docs/superpowers/specs/2026-06-17-news-design.md](docs/superpowers/specs/2026-06-17-news-design.md).
