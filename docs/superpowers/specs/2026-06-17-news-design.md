# News — curated, AI-filtered Hacker News

**Status:** approved design (2026-06-17)
**Location:** `/Users/just/Documents/code-personal/news` (sibling of `stelplaats`)
**Repo (to be created by the user):** `JustWallage/news`
**Production URL:** `https://news.justwallage.nl`

## Purpose

A single-user (just@wallage.nl) Hacker News front page, curated to personal
preferences. Every morning at 06:20 Europe/Amsterdam time the app pulls the HN
front page, filters it through Workers AI (Llama 70B) against a plain-text
preferences blob, and stores the matches in D1. The site renders them exactly
like the HN front page (title-as-link, points, age, comments link) and records
which links the user opened.

## Non-goals (now)

See [BACKLOG.md](../../BACKLOG.md). Deliberately out of scope for v1:

- An archive of every story ever selected (rows are kept in D1 to make this
  cheap later, but no archive page is built).
- Like/dislike feedback on suggestions that updates the preferences.

## Stack — identical to stelplaats

Mirror the stelplaats project exactly, including commands, configs, and the
deployment pipeline:

- **Frontend:** Vite + React 19 SPA, react-router, Tailwind v4, shadcn (Base UI
  primitives), zod-parsed fetches.
- **Worker:** Hono app; `worker/index.ts` is the composition root. Routes in
  `worker/routes/`, identity in `worker/middleware/auth.ts`, D1 access via
  `worker/lib/db.ts` (Drizzle).
- **Contracts:** `shared/` holds the zod schemas that cross the worker/frontend
  boundary; both sides infer from them. No imports from `worker/` or `src/`.
- **DB:** `db/schema.ts` (Drizzle) + generated SQL migrations applied by
  wrangler (not drizzle-kit).
- **e2e:** Playwright in `e2e/`, ephemeral worker+D1 per CI run.
- **IaC:** Terraform in `iac/` with R2-backed state; owns prod D1, the Access
  app + Google IdP, and the custom domain.
- **Quality gate:** `pnpm check` (format, lint, types, knip, jscpd, terraform
  fmt/validate, unit tests) as the Husky pre-commit hook. `pnpm dev` full-stack
  dev server; `pnpm test:e2e` Playwright.

### Differences from stelplaats

1. **No Durable Object / WebSocket.** This is a once-a-day read app; there is
   nothing to push live. Drop `worker/do/`, `WEBSOCKET_DO`, the `/api/ws` route,
   `WebSocketContext`, and the DO migration from wrangler.jsonc.
2. **Workers AI binding** `AI` added to wrangler.jsonc (production env only, so
   local/e2e never open a remote AI connection); surfaced by `pnpm cf-typegen`
   and therefore optional on the base `Env` (narrowed before use).
3. **Cron triggers** added to wrangler.jsonc; a `scheduled` handler is exported
   alongside the Hono `fetch` handler.
4. **Domain + Access activate immediately.** The `justwallage.nl` zone already
   exists, so unlike stelplaats (which deferred the domain) Terraform creates
   the custom domain and the self-hosted Access app from the first deploy. There
   is no interim "enable Access on workers.dev" manual step.
5. `ALLOWED_EMAILS = "just@wallage.nl"` (single user).

## Architecture

```
shared/      zod contracts: story (feed item), preferences, digest result, me, health
worker/      Hono app + scheduled handler
  index.ts     composition root: auth + deps-injection middleware + scheduled export
  middleware/  auth.ts (CF Access → ALLOWED_EMAILS), same pattern as stelplaats
  routes/      stories.ts, preferences.ts, digest.ts (run)
  lib/         db.ts, hn.ts (HN client), ai.ts (Llama filter), fakes.ts,
               deps.ts (createDeps — the one env branch), digest.ts, serialize.ts,
               scheduled.ts, time.ts
src/         React SPA: pages/HomePage.tsx, pages/PreferencesPage.tsx,
             components/ (AuthGate, Layout, StoryRow), hooks/useCachedFetch.ts
db/          schema.ts + migrations
e2e/         home.spec.ts, preferences.spec.ts (unique-email, parallel, no reset)
iac/         D1 prod, Access app + Google IdP, custom domain news.justwallage.nl
scripts/     bootstrap.sh, worktree.sh, worktree-merge.sh
docs/        BOOTSTRAP.md, BACKLOG.md
```

## Data model (D1 / Drizzle)

Content is split from curation: `stories` is a **global, persistent cache** of
story content (like real life — it always has rows); `curations` is a
**per-user** join table that is the feed + archive. This separation is what
makes e2e tests isolate per user and run in parallel.

### `stories` (global content cache, PK = HN item id)

| column      | type                | notes                                             |
| ----------- | ------------------- | ------------------------------------------------- |
| `id`        | integer PK          | HN item id (NOT autoincrement)                    |
| `title`     | text not null       |                                                   |
| `url`       | text nullable       | null for Ask/Show HN self-posts                   |
| `by`        | text not null       | HN author                                         |
| `score`     | integer not null    | points (refreshed on re-download)                 |
| `comments`  | integer not null    | HN `descendants`                                  |
| `time`      | integer (timestamp) | HN submission time                                |
| `fetchedAt` | integer (timestamp) | last download; drives the 60s incremental refetch |

Rows are never deleted. The digest only downloads `item/<id>` for ids that are
missing or whose `fetchedAt` is older than 60s.

### `curations` (per-user feed + archive, PK `(userEmail, storyId)`)

| column           | type                | notes                                          |
| ---------------- | ------------------- | ---------------------------------------------- |
| `userEmail`      | text                | the curated-for user                           |
| `storyId`        | integer             | → `stories.id`                                 |
| `relevanceScore` | integer not null    | 0–100 (0 for the unfiltered fallback)          |
| `reason`         | text not null       | short AI rationale (stored, not shown in v1)   |
| `curatedAt`      | integer (timestamp) | run that last selected this story for the user |
| `current`        | integer (boolean)   | in the user's LIVE feed (vs archived)          |
| `openedAt`       | integer (timestamp) | nullable; first open, preserved across runs    |

- Feed = `curations ⋈ stories WHERE userEmail = me AND current`, ordered by
  relevance then score. A digest run flips the user's rows to `current=false`,
  then upserts the freshly selected to `current=true` (keeping `openedAt`).
- Older curations stay as the user's archive → the backlog "archive" page is
  just dropping the `current` filter.

### `preferences` (per user, PK `userEmail`)

`{ userEmail, text, updatedAt }` — the plain-text interests blob.

## API (all under `/api`, behind `authMiddleware`)

| method + path                | body / result                                          |
| ---------------------------- | ------------------------------------------------------ |
| `GET /api/health`            | `{ ok, email }` (AuthGate probe)                       |
| `GET /api/me`                | `{ email }`                                            |
| `GET /api/stories`           | `{ stories: Story[] }` — the user's current feed       |
| `POST /api/stories/:id/open` | records `openedAt` for the user (idempotent); `{ ok }` |
| `GET /api/preferences`       | `{ text, updatedAt }` (empty string if unset)          |
| `PUT /api/preferences`       | `{ text }` → upsert; `{ ok }`                          |
| `POST /api/digest/run`       | runs the digest for the current user; `{ count }`      |

There is no `/api/test/*` surface. `POST /api/digest/run` is the single trigger
used by the homepage Refresh button, the 06:20 cron (for the owner), and e2e.
Deps come from the root injection, so it is environment-agnostic.

## Cron pipeline

**Schedule:** wrangler `triggers.crons = ["20 4 * * *", "20 5 * * *"]` (UTC).
The `scheduled` handler computes the current hour in `Europe/Amsterdam` via
`Intl.DateTimeFormat` and proceeds **only when that hour is 6**. This fires
exactly once at 06:20 NL year-round:

- CEST (summer, UTC+2): 04:20 UTC = 06:20 NL → run; 05:20 UTC = 07:20 NL → skip.
- CET (winter, UTC+1): 05:20 UTC = 06:20 NL → run; 04:20 UTC = 05:20 NL → skip.

**Steps (`worker/lib/digest.ts` `runDigest(db, deps, prefs, userEmail, now)`):**

1. Fetch `topstories.json` (500 ids); take the top 100.
2. Look up which of those ids are already cached in `stories`; download
   `item/<id>.json` (concurrency-limited, ~8 at a time) ONLY for ids that are
   missing or whose `fetchedAt` is older than 60s. Upsert fetched items
   (content + `fetchedAt`); keep `type === "story"`, drop dead/deleted.
3. Candidates = the cached `stories` rows for the top ids.
4. Load the preferences text. If empty, skip the AI call and select the top 30
   candidates by score (page never blank). Otherwise batch ~25–30 candidates per
   Workers AI call to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with a strict
   "exclude when unsure" prompt; keep `relevant === true`.
5. Replace the user's feed: set `current=false` for all of the user's curations,
   then upsert each selected story into `curations` (`current=true`, refreshed
   `curatedAt`/relevance, preserving `openedAt`).

**Testability:** see "Service seams & injection" below.

## Service seams & injection

Test code never lives in production functions. The gate is `ENVIRONMENT`
(deploy-time: `local` / `e2e` / `production`), the same single gate stelplaats
uses — never a per-request `isTest` flag that services branch on (that is the
service-locator anti-pattern: it hides the dependency and ships the test branch
inside prod code).

The two external dependencies are defined as interfaces and injected at the
composition root:

```ts
// worker/lib/hn.ts
export interface HnClient {
  topStoryIds(): Promise<number[]>;
  item(id: number): Promise<HnItem | null>;
}
export const realHnClient: HnClient = {
  /* firebaseio.com */
};

// worker/lib/ai.ts
export interface AiFilter {
  select(prefs: string, stories: StoryInput[]): Promise<Verdict[]>;
}
export const makeRealAiFilter = (ai: Ai): AiFilter => ({
  /* env.AI.run(llama) */
});
```

`runDigest` is pure — it receives its deps and has zero environment awareness.
The single place that picks an implementation is `worker/lib/deps.ts`:

```ts
export function createDeps(env: Bindings): Deps {
  if (env.ENVIRONMENT === "production" && env.AI !== undefined) {
    return { hn: realHnClient, ai: makeRealAiFilter(env.AI) };
  }
  return { hn: fakeHnClient, ai: fakeAiFilter }; // local + e2e
}
```

`index.ts` runs a middleware that sets `c.var.deps = createDeps(c.env)` for every
`/api/*` request; the cron calls `createDeps(env)` directly. So `POST
/api/digest/run`, the `scheduled` handler, and every route are identical across
environments — no `ENVIRONMENT`/`isTest` branch leaks into a handler, and there
is no test-only route.

**Local + e2e use fakes** (`fakeHnClient` returns a canned story list;
`fakeAiFilter` marks a story relevant when its title contains a word from the
prefs). So `pnpm dev` shows realistic data, CI is hermetic, and the first real
data appears when `POST /api/digest/run` runs on the deployed production worker.
Unit tests call `runDigest` with fakes directly.

## Prompt design (Llama 70B filter)

- **System:** "You are a strict relevance filter for a personal Hacker News
  feed. Given the user's interests and a list of stories, return ONLY the
  stories that clearly match. When unsure, exclude. Judge by title and link
  domain. Respond with JSON only."
- **Response format:** Workers AI `response_format: { type: "json_schema" }`
  with an array of `{ id:int, relevant:bool, score:int(0-100), reason:string }`.
- Batches of 25–30 keep each call small and let the model compare within a
  batch. Threshold on `relevant === true` (score retained for future tuning).

## Auth & access

- `worker/middleware/auth.ts`: identical pattern to stelplaats. Production reads
  `Cf-Access-Authenticated-User-Email`, re-checks against `ALLOWED_EMAILS`
  (`just@wallage.nl`). `local` uses `DEV_USER_EMAIL`; `e2e` uses the timing-safe
  `X-Test-Auth` + `X-Test-User-Email` pattern.
- Logout link in the UI → `/cdn-cgi/access/logout`.
- Terraform (`iac/main.tf`): reuse the Google IdP; create one self-hosted Access
  application on `news.justwallage.nl` with a single allow policy for
  `just@wallage.nl`; create the Workers custom domain. All gated on
  `custom_domain_zone_id`, which IS supplied from day one.

## Deployment — identical pipeline

- `.github/workflows`: `deploy.yml` (check-and-build → terraform apply →
  ephemeral-e2e → deploy-prod), `check-and-build.yml`, `branch-pipeline.yml`,
  `ephemeral-e2e.yml`. Same `-skip-e2e` / `run-pipeline` commit-title controls.
- Prod D1 id from terraform output templated into wrangler.jsonc by CI
  (`TEMPLATE_PROD_DB_ID`); ephemeral e2e uses `TEMPLATE_E2E_DB_ID`.
- Terraform state in R2 bucket `news-tfstate`; prod D1 `news-prod`.
- No Home Assistant secret-sync step (not applicable).

## Required setup (user performs; agent does NOT commit or create the repo)

GHA secrets (via `scripts/bootstrap.sh`), same set as stelplaats **plus**
`CUSTOM_DOMAIN_ZONE_ID`:

- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (must include **Workers AI**
  Read/Run in addition to Workers Scripts / D1 / R2 / Access edit),
  `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (reuse the existing Access Google
  client), `TEST_AUTH_TOKEN`, `WORKERS_DEV_SUBDOMAIN`, `CUSTOM_DOMAIN_ZONE_ID`
  (zone id of `justwallage.nl`).

No manual "enable Access on workers.dev" step (domain+Access are Terraform-managed
from the first deploy). Because local/e2e use fakes, real data first appears in
production: after the first pipeline deploy, sign in at `https://news.justwallage.nl`,
set your preferences, then hit `POST /api/digest/run` once to populate before the
first 06:20 cron.

## Testing

- **Unit (vitest-pool-workers):** auth middleware (allow/deny), the digest
  pipeline with injected fakes (per-user curation, incremental download, 60s
  stale refetch, feed replacement preserving `openedAt`, per-user isolation,
  empty-prefs fallback), the API routes against real workerd+D1, the
  Europe/Amsterdam hour guard. One D1 per test file → `beforeEach` clears tables.
- **e2e (Playwright):** each test runs as a unique random user (`fixtures.ts`
  overrides `extraHTTPHeaders`), so tests are isolated and run `fullyParallel`
  with no DB reset. Coverage: empty-feed guidance, the Refresh button curating
  from preferences, HN-style rendering + working links, preferences save/reload,
  signed-in identity + logout link.
