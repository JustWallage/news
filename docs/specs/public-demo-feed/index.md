# Public demo: the owner's live curated feed, no sign-in

## Original request (verbatim)

> Implement docs/0-backlog/public-demo-owner-curations.md, one question before
> you start: what is the production owner email and why shouldn't we hardcode
> it? I think that would be find right since it's purely as the demo for
> visitors? Also I think it's best if we add a "Show live demo" button on the
> homepage in a good place, close to the sign in flow so that visitors can view
> the owner's live feed when they want to without having to login.

## Background

A Google sign-in wall before a visitor can see _anything_ is the biggest bounce
risk for a public/Show HN launch. The fix: let anyone view a real, live example
feed — the owner's own curated front page — without authenticating.

The original backlog note (`docs/0-backlog/public-demo-owner-curations.md`)
recommended a demo _strip_ auto-rendered at the top of the landing page. The
user has overridden that: instead, a **"Show live demo" button** next to the
sign-in CTA navigates to a dedicated public **`/demo`** route that renders the
owner's read-only feed.

There is currently **no "owner" concept** anywhere in the codebase: production
identity comes entirely from Google OAuth (whoever signs in is their own
account). This feature introduces a single piece of config — `OWNER_EMAIL` —
naming which account's stored feed is the public demo.

## Decisions

- **[user]** Demo target is configured via an `OWNER_EMAIL` **var** in
  `wrangler.jsonc` (committed, per-environment), NOT a hardcoded source literal
  and NOT a secret. Rationale: it is an email used to _select_ a public feed, not
  a credential; and it MUST be overridable per environment so the e2e suite can
  point it at a seeded test account (a hardcoded literal would make the feature
  impossible to verify end-to-end).
- **[user]** Visitors reach the demo via a **"Show live demo" button** on the
  landing page, placed next to the sign-in CTA, navigating to a dedicated public
  **`/demo`** route (not an inline reveal, not an auto-rendered strip).
- **[AI]** The public endpoint lives **outside `/api`** (`GET /public/feed`),
  exactly like `/auth/*` and `/telegram/*`, so it is reachable without a session
  and skips the auth + deps middleware. It is added to `assets.run_worker_first`.
- **[AI]** The endpoint reads **stored `curations` only** — it never runs a
  digest / Workers AI. This is the hard requirement from the backlog note:
  anonymous traffic must never burn the Neuron budget. The owner's own cron +
  Refresh keep the stored feed fresh.
- **[AI]** The public response uses a **dedicated `publicStorySchema`** (derived
  from `storySchema` via `.pick`) exposing only HN-public fields
  (`id, title, url, by, score, comments, time`). Curation-private fields
  (`openedAt`, `relevanceScore`, `reason`) are NOT in the public contract, so a
  private field can never leak even if `storySchema` later grows one.
- **[AI]** Response also carries `lastCuratedAt` (nullable ISO datetime), the
  latest `curatedAt` among the owner's current curations, for the "last refreshed
  X" line.
- **[AI]** The existing global `Cache-Control: private, no-store` invariant is
  left **untouched**; the public endpoint inherits it. CDN/public caching of the
  demo is an explicit non-goal here (the AI-budget protection comes from reading
  stored data, not from caching). Out of scope.
- **[AI]** `OWNER_EMAIL` is widened to `string` in `worker/env.ts` (same pattern
  as `TELEGRAM_BOT_USERNAME`) because its committed value differs per env, which
  `cf-typegen` would otherwise narrow to a literal union.
- **[user]** `OWNER_EMAIL` values: production `just@wallage.nl`, local
  `just@wallage.nl`, e2e `owner@news.test`.

## Requirements

### Shared contract (`shared/api.ts`)

- Add `publicStorySchema = storySchema.pick({ id, title, url, by, score,
comments, time })` and `export type PublicStory = z.infer<...>`.
- Add `demoFeedSchema = z.object({ stories: z.array(publicStorySchema),
lastCuratedAt: z.iso.datetime().nullable() })` and `export type DemoFeed`.
- Update `shared/CLAUDE.md` to mention the new public demo contract.

### Worker

- **Config** (`wrangler.jsonc`): add `OWNER_EMAIL` to the top-level (local)
  `vars`, the `env.e2e.vars`, and `env.production.vars`. Values: local
  `just@wallage.nl`, e2e `owner@news.test`, production per the decision above.
  Run `pnpm cf-typegen` after.
- **Type** (`worker/env.ts`): widen `OWNER_EMAIL` to `string` via the existing
  `Omit<Env, ...> & { ... }` pattern, with a short comment mirroring the
  `TELEGRAM_BOT_USERNAME` rationale.
- **Route** (`worker/routes/public.ts`, new): `publicRoutes.get("/feed", ...)`:
  - Resolve the owner feed from stored curations: reuse `curatedStories(db,
c.env.OWNER_EMAIL, true)` ordered best-match-first (same ordering as
    `loadFeed`), map each row to the public-safe fields only.
  - Compute `lastCuratedAt` = max `curatedAt` among the owner's `current`
    curations (null when the owner has none).
  - Return `demoFeedSchema.parse(...)` (the no-casts pattern, like
    `lib/serialize.ts`).
  - Never invoke `c.var.deps` / AI (deps are not even injected on this path).
- **Serialization** (`lib/feed.ts`): add `loadPublicFeed(db, ownerEmail)`
  returning `{ stories: PublicStory[]; lastCuratedAt: string | null }`. It runs a
  **single** query selecting the public fields **plus `curations.curatedAt`**,
  ordered best-match-first (`desc(relevanceScore), desc(score)`), where
  `userEmail = ownerEmail AND current`; map rows to `PublicStory` and derive
  `lastCuratedAt` as the max `curatedAt` across the loaded rows in JS (no second
  query; null when there are no rows). Do not duplicate the `curatedStories`
  ordering by hand if it can be reused cleanly.
- **Mount** (`worker/index.ts`): `app.route("/public", publicRoutes)` alongside
  `/auth` and `/telegram` (outside `/api`, so no auth/deps middleware). Add a
  short comment matching the existing "intentionally NOT under /api" note.
- **`run_worker_first`** (`wrangler.jsonc`): add `"/public/*"`.
- Update `worker/CLAUDE.md` (ownership of the new public route + the
  `OWNER_EMAIL` binding row + the no-AI / public-contract invariant).

### Frontend (`src/`)

- **Routing** (`src/App.tsx`): make `/demo` public (outside `AuthGate`) while the
  rest stays gated. Restructure so `AuthGate` wraps the `Layout` route element:
  ```tsx
  <Routes>
    <Route path="/demo" element={<DemoPage />} />
    <Route
      element={
        <AuthGate>
          <Layout />
        </AuthGate>
      }
    >
      <Route index element={<HomePage />} />
      <Route path="archive" element={<ArchivePage />} />
      <Route path="preferences" element={<PreferencesPage />} />
    </Route>
  </Routes>
  ```
  `AuthGate` keeps its current behavior (loading → spinner, denied → LandingPage,
  ok → children = Layout). `Analytics` stays mounted above. FeedProvider stays in
  Layout (so the demo page never mounts it).
- **`DemoPage`** (`src/pages/DemoPage.tsx`, new):
  - Fetch `GET /public/feed` via `useCachedFetch("/public/feed", demoFeedSchema)`
    (reads go through the cached-fetch hook per `src/CLAUDE.md`).
  - Render the stories with the **existing `StoryRow`** (do NOT duplicate the
    HN-row markup — jscpd would flag it). `StoryRow` currently requires the full
    `Story` type and a required `onOpen`; a `PublicStory` is not assignable to it
    and `as` casts are forbidden. So **widen `StoryRow`'s props** to the
    structural subset it actually reads: `story: Pick<Story, "id" | "title" |
"url" | "by" | "score" | "comments" | "time"> & { openedAt?: Story["openedAt"]
}` and make `onOpen?: (id: number) => void` optional. The greying check
    becomes `story.openedAt != null && ...` (undefined → not opened) and the
    `onClick` calls `onOpen?.(story.id)`. `HomePage`/`ArchivePage` keep passing a
    full `Story` (a valid superset) unchanged. The demo passes `PublicStory`
    directly with no `onOpen` — no fabricated fields, no cast.
  - Header line: "The owner's live picks" + "last refreshed {relative time}"
    derived from `lastCuratedAt` (reuse `relativeTime` from `lib/format.ts`);
    omit the "last refreshed" clause when `lastCuratedAt` is null.
  - A clear line making it unmistakable these are the owner's _personal_ picks,
    e.g. "These are my picks — sign in to get your own feed tuned to yours."
  - A sign-in CTA / link back so a convinced visitor can convert, and a way back
    to the landing page.
  - Read-only: no Refresh button, no open-tracking POSTs.
- **Landing button** (`src/components/LandingPage.tsx`): add a "Show live demo"
  button next to the existing `SignInCta`, navigating to `/demo` (react-router
  `Link`/`useNavigate`, client nav — LandingPage already renders inside the
  Router). Style it as a secondary action so the primary sign-in CTA stays
  prominent.
- Update `src/CLAUDE.md` (the new public `/demo` route, that it is OUTSIDE
  `AuthGate`, reads `/public/feed`, and is read-only; the widened `StoryRow`
  signature).
- No CSP change: `/demo` is served as the SPA document by the asset handler
  (`not_found_handling: single-page-application`), so it uses `public/_headers`
  like the rest of the SPA and introduces no new outbound origin (same-origin
  `/public/feed` fetch, reused `StoryRow`).

## Tests

### Worker unit test (`worker/routes/public.test.ts`, new — or extend `api.test.ts`)

- Seed the `stories` cache + `curations` for `OWNER_EMAIL` (`current = true`)
  directly via the test DB, then `GET /public/feed` and assert:
  - The response parses as `demoFeedSchema`, stories are ordered best-match
    first, and contain ONLY the public fields (assert `openedAt`,
    `relevanceScore`, `reason` are absent from the JSON payload).
  - `lastCuratedAt` equals the latest seeded `curatedAt`.
  - With no owner curations, `stories` is empty and `lastCuratedAt` is null.
  - The endpoint requires **no** auth headers (it is outside `/api`).
- Note: the unit-test pool runs the e2e env (`OWNER_EMAIL = owner@news.test`),
  so seed under that email.

### e2e (`e2e/demo.spec.ts`, new — single self-contained test to avoid races on the shared owner account)

`OWNER_EMAIL` is fixed (`owner@news.test`) and shared across runs, and the local
e2e D1 persists between runs, so the test must be state-independent (re-seed at
the start, assert relative to that seed) and must be the ONLY test touching the
owner account.

- Seed the owner's stored feed by issuing requests **with explicit owner
  headers** (`X-Test-User-Email: owner@news.test`): `PUT /api/preferences`
  `{ text: "rust" }` then `POST /api/digest/run` → owner's stored feed = the Rust
  story (fake AI selects by pref match).
- Then change the owner's prefs to `{ text: "bitcoin" }` **without** running a
  digest.
- Anonymous-style visit to `/demo` (the public endpoint ignores headers): assert
  the **Rust** story is visible and the **Bitcoin** story is hidden — proving the
  demo serves the _stored_ feed and did NOT re-run the AI filter (otherwise it
  would have re-curated to Bitcoin).
- Assert the demo page shows the "these are my picks / sign in" CTA and a
  "last refreshed" line, and that there is **no Refresh button**.
- From the landing page (unauthenticated), assert the **"Show live demo"** button
  is present and navigates to `/demo`.

### Gate

- `pnpm -F <touched pkgs> run check` then root `pnpm check` green.
- `pnpm test:e2e` green for the new spec.

## Out of scope

- Public/CDN caching of the demo response (kept `no-store`; AI-budget protection
  is from reading stored data only).
- Any open-tracking, refresh, or AI run on the anonymous path.
- Replacing or restructuring the existing landing-page explainer content (only a
  button is added).
