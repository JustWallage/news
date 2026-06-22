# News

A public, AI-curated Hacker News front page: anyone signs in with Google and
gets their own feed. A single Cloudflare Worker serves the React SPA as static
assets and the Hono API, runs the Google OAuth sign-in flow itself, and filters
the HN front page through Workers AI (Llama 70B) against each user's plain-text
preferences blob, storing the matches in D1. Curation runs on demand (homepage
Refresh / Telegram `/fetch`) and on a `*/5` cron that pushes a Telegram summary
to each user at their configured slot.
[SPEC.md](docs/superpowers/specs/2026-06-17-news-design.md) is the original design
document; [docs/BACKLOG.md](docs/BACKLOG.md) holds deferred ideas.

## Structure

```
shared/    Zod schemas = THE contracts (API bodies) shared by worker + SPA
worker/    Hono app + scheduled (cron) handler. index.ts is the composition
           root; routes/, middleware/, lib/ (hn, ai, digest, scheduled, time)
src/       React SPA (pages/, components/, hooks/, lib/)
db/        Drizzle schema.ts + generated SQL migrations
e2e/       Playwright specs + fixtures
iac/       Terraform (prod D1, Cloudflare Access, custom domain)
scripts/   bootstrap.sh (one-time cloud setup)
docs/      BOOTSTRAP.md (manual setup), BACKLOG.md (future ideas)
```

## Commands

- `pnpm check` — THE gate: format, lint, types, knip, jscpd, terraform, unit tests.
  Must pass before any commit (it is the pre-commit hook). Never bypass it.
- `pnpm test:e2e` — Playwright; auto-starts its own dev server (port 5174).
- `pnpm dev` — full-stack dev server (workerd with real D1) on port 5173.

## Hard rules

- `as` casts are forbidden (ESLint enforces; only `as const` is allowed). Fix
  the types instead — usually by parsing with a schema from `shared/`.
- Types crossing a boundary live in `shared/` (z.infer) or come from Drizzle
  inference (`db/schema.ts`). Never redefine them locally.
- knip fails on unused exports/files/deps: don't export "for later".
- After changing `wrangler.jsonc`, run `pnpm cf-typegen` (also runs in check).
- Before implementing a new feature, create an isolated worktree with
  `pnpm worktree <branch-name>` (no `open` flag) and work there.
- Every change that includes logic => add relevant e2e tests.
- Every change: `pnpm check` green + relevant e2e coverage.
- No comments unless absolutely necessary to understand non-obvious code, and
  then keep them short and inline. Never write comments that explain a change,
  restate what the code does, or narrate history — the diff and git do that.
- Keep [README.md](README.md) current for big changes only (new capabilities,
  shifts in architecture or workflow); skip it for small changes it never mentions.

## Docs standard — MUST keep updated

Nested CLAUDE.md per package = AI context. Shared patterns → `docs/claude/`.

Content test — every line must pass: "would AI get this wrong, or need to read code first, without it?"

Keep:

1. Ownership — which package owns what
2. Invariants code doesn't shout (digest selection rules, the DST cron guard, upsert behavior)
3. Cross-package contracts — schema names, who consumes whom
4. Domain language — exact terms + forbidden synonyms
5. Gotchas — the AI binding seam, prod-only paths, idempotency traps

Delete: file listings, API signatures, anything an ls/grep reveals or types imply. These rot, and AI reads code faster than stale prose.
Brevity: note the invariant + where to grep — don't transcribe enumerations that live in code. Shorter > exhaustive.
Rule: always update CLAUDE.md (or docs/claude/) in same commit when something from list above was changed. Stale doc worse than none. Reference shared docs by plain path, never `@`-import.
