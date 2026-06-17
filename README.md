# news

A personal, AI-curated Hacker News front page for one user, hosted at
`news.justwallage.nl` on Cloudflare.

Every morning at 06:20 (Europe/Amsterdam) a cron pulls the Hacker News front
page (the Algolia HN API — one request, full content), filters it through
Workers AI (Llama 70B) against a plain-text preferences blob, and stores the
matches in D1. The site renders them like the HN front page — title (link),
points, age, comments — and tracks which links you've opened.

## Stack

Vite + React 19 SPA and a Hono API served by one Cloudflare Worker; D1 (Drizzle)
for storage; Workers AI for filtering; Zod contracts in `shared/`; Terraform for
infra (prod D1, Cloudflare Access, custom domain); Playwright e2e; a single
`pnpm check` gate enforced as the pre-commit hook.

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

- **`/`** — the curated feed (the latest morning's picks).
- **`/preferences`** — your signed-in identity, a logout link, and a big
  plain-text box describing what you want to read.

## Setup & deploy

One-time cloud setup is in [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md). Pushing to
`main` runs the full pipeline (checks → terraform → ephemeral E2E → deploy).
Future ideas live in [docs/BACKLOG.md](docs/BACKLOG.md); the authoritative
design is [docs/superpowers/specs/2026-06-17-news-design.md](docs/superpowers/specs/2026-06-17-news-design.md).
