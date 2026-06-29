# SA validation — Public demo: owner's live curated feed

Spec: `docs/specs/public-demo-feed/index.md`
Reviewer: senior solutions architect (design gate, pre-implementation)

## Summary

The spec is sound and well-sized. It solves a real bounce problem (sign-in wall)
by exposing the owner's already-stored curations on an unauthenticated route, and
it correctly identifies the load-bearing invariant: the anonymous path must read
stored `curations` only and never touch Workers AI. Every architectural decision
maps cleanly onto an established pattern already in the codebase
(`/auth`, `/telegram` sitting outside `/api`; the `Omit<Env, ...> &` env widening;
the `.parse(...)` serialization boundary; `useCachedFetch`). I verified each claim
against real code.

There is one blocking design gap and two minor clarifications, all in the frontend
`StoryRow` reuse. None touch the worker/contract design, which is clean. Resolve the
`StoryRow` prop-type question and this is good to build.

## Findings by axis

### Soundness — solves the problem, right shape

Strong. The core mechanism is correct against the code:

- `curatedStories(db, email, true)` (`worker/lib/feed.ts:9`) already returns exactly
  the join the public endpoint needs, and `loadFeed` (`feed.ts:32`) already orders
  `desc(relevanceScore), desc(score)` — the "best-match-first" ordering the spec
  promises is real and reusable, not aspirational.
- `curations.curatedAt` exists (`db/schema.ts:38`), so `lastCuratedAt = max(curatedAt)`
  over `current=true` rows is computable. Note it can be derived from the same rows
  already loaded (no second query needed) — a `Math.max` over the mapped rows is the
  simplest correct form. The spec's "compute max curatedAt" is fine either way; flag
  only so the implementer does not add a redundant query.
- The no-AI guarantee is structurally enforced, not just promised: `c.var.deps` is
  injected by middleware bound to `/api/*` only (`worker/index.ts:49`). A route under
  `/public` never has `deps` set, so it _cannot_ invoke AI even by mistake. This is
  the right shape — the protection is the absence of the binding, not discipline.

### Right-sizing — simplest correct

Well-judged, no over- or under-engineering:

- `publicStorySchema` via `storySchema.pick({...})` is the minimal correct way to
  guarantee private fields (`openedAt`, `relevanceScore`, `reason`) can never enter
  the public contract even if `storySchema` grows. This is right-sized: it costs one
  `.pick` and removes a whole class of future leak.
- Explicitly making CDN/public caching out-of-scope is the correct call. The budget
  protection comes from reading stored data, so caching would be premature
  optimization that also fights the global `no-store` invariant.
- `OWNER_EMAIL` as a committed per-env `var` (not secret, not literal) is correct and
  the rationale is sound: it is a selector, not a credential, and it must be
  overridable so e2e can point at `owner@news.test`. The `Omit<Env, ...> & { OWNER_EMAIL: string }`
  widening mirrors the existing `TELEGRAM_BOT_USERNAME` / `ENVIRONMENT` treatment
  (`worker/env.ts:28-44`) exactly — same problem (cf-typegen narrows a committed var
  to a literal), same fix.

### Codebase fit — reuse over reinvent, invariants intact

Mostly excellent, one real snag.

- Route placement, mount, and `run_worker_first` all match the `/auth` + `/telegram`
  precedent verbatim (`worker/index.ts:63-70`, `wrangler.jsonc:16-25`). The existing
  comment already explains that `run_worker_first` is path- not host-scoped and that
  stray hits just 404 — adding `/public/*` fits without new reasoning.
- `useCachedFetch` → `apiFetch` is a plain `fetch(path)` (`src/lib/api.ts:13`,
  `src/hooks/useCachedFetch.ts`), so it works for `/public/feed` despite the "/api"
  naming. The spec's choice to route reads through it (per `src/CLAUDE.md`) is the
  conformant path. Confirmed no auth header is required by `apiFetch`.
- The App.tsx restructure is valid: `LandingPage` is what `AuthGate` renders on
  `denied` (`AuthGate.tsx:43`), and it already lives inside `BrowserRouter`
  (`App.tsx:22`), so a react-router `Link` to `/demo` works. Moving `AuthGate` to wrap
  the `Layout` route element (rather than the whole `<Routes>`) leaves `/demo`
  ungated while `Analytics` stays mounted above — correct.
- `FeedProvider` lives in `Layout` (`Layout.tsx:47`), so a `/demo` route outside
  `Layout` never mounts it. The spec's claim holds.

**BLOCKING — `StoryRow` reuse does not typecheck as described.** `StoryRow`
(`src/components/StoryRow.tsx:5-13`) requires `story: Story` and reads
`story.openedAt` (line 31, for the greying class) plus a required `onOpen: (id) => void`.
`PublicStory` (from `.pick`) has no `openedAt`, `relevanceScore`, or `reason`, so it
is **not** assignable to `Story`. The spec says "map each `PublicStory` to the props
`StoryRow` reads, with `onOpen` a no-op" — but there is no prop subset to map to;
the prop type is the whole `Story`. With `as` casts forbidden (CLAUDE.md hard rule),
the implementer cannot paper over this. One of:

1. Widen `StoryRow` to accept a narrower structural type (e.g. `Pick<Story,
"id" | "title" | "url" | "by" | "score" | "comments" | "time"> & { openedAt?: ... }`)
   and make `onOpen` optional — small, clean, keeps one component.
2. Construct a full `Story` in `DemoPage` by filling the three private fields with
   inert defaults (`openedAt: null`, `relevanceScore: 0`, `reason: ""`). Cheap, but
   fabricates contract fields the public payload deliberately dropped — slightly
   off-design.

Option 1 is the better fit (no fabricated fields, no cast). The spec must state which,
because "map to the props it reads" is not achievable as written and the resolution
changes `StoryRow`'s signature — a shared component other pages use.

### Risk / gaps / edge cases

- Empty-owner case is covered (stories empty, `lastCuratedAt` null) in both the
  endpoint contract and the unit test.
- The e2e race/state hazard is correctly called out: shared `owner@news.test`,
  persistent local e2e D1, so the test re-seeds and must be the only one touching the
  owner account. The rust/bitcoin assertion is a genuinely good test — it proves the
  _stored_ feed is served and AI did NOT re-run (otherwise it would re-curate to
  bitcoin). The fake AI selects by pref match (verify the fake's behavior at
  implementation time, but the design is right).
- The unit-test pool runs the e2e env, so `OWNER_EMAIL = owner@news.test` there; the
  spec says seed under that email. Correct and easy to get wrong, good that it is
  flagged.
- Minor: `secureHeaders` CSP is `default-src 'none'` globally (`index.ts:29-32`).
  Story links are anchors (no fetch/script), so the demo page renders fine, but the
  implementer should confirm no new outbound asset (e.g. favicon fetch) is introduced
  on `/demo` that the CSP would block. Not a design change — just a render check.

## Open questions

1. **`StoryRow` prop-type resolution (blocking).** Which approach — widen `StoryRow`'s
   prop type / make `onOpen` optional (recommended), or fabricate a full `Story` in
   `DemoPage`? Recommend widening `StoryRow` to a structural subset so no contract
   fields are invented and no cast is needed.
2. **Production `OWNER_EMAIL` value.** Already correctly deferred to the confirmation
   step (`[USER TO CONFIRM]`, default `just@wallage.nl`). Not blocking the design;
   confirm before deploy. Recommend the proposed `just@wallage.nl`.

## Spec-change list (before implementation)

1. Replace the `StoryRow` reuse instruction with the chosen concrete approach
   (recommend: widen `StoryRow` to `Pick<Story, public fields>` + optional `openedAt`
   - optional `onOpen`, and update the existing `HomePage`/`ArchivePage` callers if
     the signature changes). State explicitly that no `as` cast and no fabricated
     contract field is used.
2. (Optional clarity) Note that `lastCuratedAt` is derivable from the rows already
   loaded — no second query — so the implementer does not add one.

VERDICT: CHANGES_REQUESTED
