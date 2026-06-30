# Code review — Public demo: owner's live curated feed

Spec: `docs/specs/public-demo-feed/index.md`
Branch: `public-demo-feed` (diff against `main`)
Reviewer: implementation gate (post-implementation)

## Summary

The implementation matches the spec closely and completely. The public endpoint
sits outside `/api` (no session, structurally no AI deps), reads stored
`curations` only, and projects to a dedicated `publicStorySchema` so private
curation fields cannot leak. The frontend adds an ungated `/demo` route, a
read-only `DemoPage` reusing a widened `StoryRow`, and a "Show live demo" button
on the landing page. The `OWNER_EMAIL` var is wired through all three envs and
widened to `string` mirroring `TELEGRAM_BOT_USERNAME`. Worker unit tests and the
e2e spec are present and pass.

Gate status:

- Root `pnpm check`: green (EXIT=0). The "ai not on env.e2e" wrangler warning is
  pre-existing on `main`, not introduced here.
- `pnpm test:e2e demo.spec.ts`: 2 passed.

No required changes. One optional nit noted below.

## Findings by axis

### Simplicity — clean

`loadPublicFeed` (`worker/lib/feed.ts:46`) reuses `curatedStories` + the
`loadFeed` ordering rather than hand-rolling a second query, and derives
`lastCuratedAt` via `Math.max` over the already-loaded rows (no extra query) —
exactly the simplest-correct form the SA validation called for. The route
(`worker/routes/public.ts:12`) is a one-liner. No redundant abstraction.

Note: the spec text (lines 93-100) literally said "a single query selecting the
public fields plus `curatedAt`," whereas the implementation selects the full
join (including private fields) via the reused `curatedStories` and then projects
in `toPublicStory`. This is a faithful reading of the spec's own stronger
instruction ("Do not duplicate the `curatedStories` ordering by hand if it can be
reused cleanly") and is the better engineering choice — the private fields never
leave the worker because serialization goes through `publicStorySchema.parse`.
No action.

### Spec implementation — complete

All requirements present and faithful:

- Shared contract: `publicStorySchema` (`.pick`) + `demoFeedSchema` with nullable
  `lastCuratedAt` (`shared/api.ts:62-83`); `shared/CLAUDE.md` updated.
- Worker: `OWNER_EMAIL` in top-level/e2e/production vars (`just@wallage.nl`,
  `owner@news.test`, `just@wallage.nl`); `/public/*` in `run_worker_first`;
  `env.ts` widening with rationale comment; `loadPublicFeed`/`toPublicStory`;
  route mounted at `/public` with the "intentionally NOT under /api" comment;
  `worker/CLAUDE.md` row + invariant section added.
- Frontend: `App.tsx` restructured so `AuthGate` wraps only the `Layout` route
  element and `/demo` is ungated; `DemoPage` reads `/public/feed` via
  `useCachedFetch`, reuses `StoryRow`, shows the "these are my picks / sign in"
  line, a relative "Last refreshed" clause (omitted when null), a sign-in CTA,
  and a link back to `/`; no Refresh, no open-tracking. `StoryRow` props widened
  to a structural subset with optional `openedAt`/`onOpen` (the SA-recommended
  Option 1 — no `as` cast, no fabricated fields). `LandingPage` button added next
  to `SignInCta` as a secondary `ghost` action. `src/CLAUDE.md` updated.
- `relativeTime(iso: string, ...)` (`src/lib/format.ts:32`) accepts the
  `lastCuratedAt` string directly — correct usage.

Nothing invented beyond the spec. Production `OWNER_EMAIL` is `just@wallage.nl`,
matching the user's stated value (line 62-63).

### No shortcuts — clean

No swallowed errors, stubs, TODOs, or hacks. The no-AI guarantee is structural
(deps middleware is bound to `/api/*` only, so `/public` never receives `deps`),
not a runtime check. `DemoPage` handles error / loading / empty / populated
states explicitly. The widened `StoryRow` uses `story.openedAt != null` so
`undefined` (public story) correctly reads as "not opened."

### Code quality — clean

Follows established conventions: serialization through schema `.parse` (no
casts), Drizzle-inferred row types in `toPublicStory`'s `Pick<FeedRow, ...>`,
react-router `Link` for client nav, `Button render={<Link/>}` pattern matching
existing usage. Comments are short and explain the non-obvious "why" (the
no-store/no-AI invariants), consistent with the repo's comment policy. ESLint /
knip / jscpd all pass under `pnpm check`.

### Tests — covered

- Unit (`worker/routes/public.test.ts`): ordering best-match-first, exact public
  key set with explicit assertions that `openedAt`/`relevanceScore`/`reason` are
  absent, `lastCuratedAt` = max, empty-owner → `[]` + null, other-account
  curations excluded, no auth headers required, and the no-store header. Thorough.
- e2e (`e2e/demo.spec.ts`): seeds owner via real `PUT /api/preferences` +
  `POST /api/digest/run` (rust), flips prefs to bitcoin without a digest, then the
  anonymous `/demo` visit shows Rust and hides Bitcoin — proving the stored feed
  is served and AI did not re-run. Asserts the picks/sign-in framing, the "Last
  refreshed" line, and no Refresh button; a separate bare test asserts the
  landing-page button navigates to `/demo`. Both pass.

Optional nit (non-blocking): the e2e test relies on the persisted owner row from
its own `digest/run` rather than clearing the owner's prior curations first. The
spec's "re-seed at the start, assert relative to that seed" is satisfied in
practice because `digest/run` upserts the current feed and this is the only spec
touching the owner account, but an explicit pre-clear would make the relative-seed
contract more obvious. Not required.

## Action list

None required.

VERDICT: APPROVED
