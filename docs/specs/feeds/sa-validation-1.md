# SA validation — Feeds spec (`docs/specs/feeds/index.md`)

## Summary

The spec adds a parallel, per-user feeds pipeline (RSS sources → AI curation →
items page + optional Telegram slots) by deliberately mirroring the proven HN
pipeline: `prefVersion` verdict reuse, `current`-flag recompute, chunked D1
upserts, cooldown-backed on-demand runs, slot-based `*/5` cron delivery, and the
`Deps`/fakes seam for hermetic e2e. Every referenced primitive was verified to
exist and behave as claimed (`dueSlot` generalizes structurally; `verdictsFor`
only reads `id`; `telegramSlotsUpdateSchema`/`digestRunResultSchema` reuse is
real; `FeedContext`/`useFeed` name collision is real and correctly avoided;
`safeHref`/`hostname`/`relativeTime`, `ConfirmDialog`, the fixtures auth, and
the `PreferencesPage` dirty-ref pattern all match). Scope cuts (newsletter
email, archive, sharing, per-feed timezone) are sensible and the schema keeps
the email path additive. The design is sound and right-sized; findings below
are non-blocking corrections/clarifications, the only factual error being the
backlog file path.

## Findings

### Soundness

- The data model is right: `feed_items` carrying the verdict directly (no join
  table) is correct for single-owner feeds; `uniqueIndex(feedId, link)` gives
  dedupe across fetches and sources; `prefVersion` reuse mirrors `curations`
  exactly. `current = member of last fetch AND relevant` matches the HN
  invariant (`current=true` implies `relevant`).
- Param math checks out: `feed_items` upsert binds 9 cols × 10 rows = 90 < 100
  (same as curations). Loading prior verdicts per `feedId` (not `inArray` of
  links) avoids the bound-param cap, matching the `prefVersion`-filter trick in
  `curateForUser`.
- Cooldown off `feeds.lastFetchedAt` is a nice reuse of existing state (no new
  table). Note the (acceptable, arguably desirable) side effect: a scheduled
  cron run also stamps `lastFetchedAt`, pushing back on-demand availability.
- `dueSlot` generalization verified: it reads only `slot1..3`
  (`worker/lib/telegram-bot.ts:95`), so widening the param type is purely
  structural; telegram call sites compile unchanged.
- Cron join (feeds with a slot × owner's `telegram` row with `chatId` not null)
  correctly leaves slots dormant after a `/disconnect` (row deleted) — no
  orphan-send path.
- Gap (minor, spec-level one-liner needed): new items have **no DB id** before
  the upsert, but `selectFeedItems` and verdict mapping are id-keyed. The
  implementation must assign synthetic ids (e.g. array index) for the AI pass —
  the spec's shape allows it, but stating it prevents the wrong turn of
  upserting first and judging second (which would break the single-pass
  `current = relevant` write).
- Gap (minor): the spec doesn't say what the cron sends for a due feed with
  zero relevant items. The HN digest sends a "nothing matched" message
  (`formatDigestMessage` empty case); `formatFeedDigestMessage` should state it
  mirrors that.

### Right-sizing

- Well-judged cuts: email source deferred (genuinely non-trivial — Email
  Routing infra; `docs/1-in-progress/email-signup.md` confirms the earlier
  deferral), no archive/read-tracking, no per-feed timezone, no new SPA context
  (pages own `useCachedFetch`, the `ArchivePage` pattern), slots reuse the
  existing 3-slot shape and update schema.
- Caps are proportionate: `MAX_FEED_SOURCES=10`, 50 items/source, 20-item page,
  15-item Telegram message, 60-day prune of non-current items.
- One under-specified guard: `realRssClient` has no **response-size cap**. A
  user-supplied URL returning a multi-MB (or unbounded) body is parsed in
  worker memory. Add a byte cap (e.g. reject bodies > ~2–5 MB) to the
  normalization contract. Small, cheap, closes the only resource-abuse hole.
- Optional hardening: `feed_sources` has no `uniqueIndex(feedId, url)`;
  duplicate rejection is app-level only. One line in the schema makes the
  invariant DB-enforced. Not required.

### Codebase fit

- Contracts-first in `shared/api.ts`, serialization via `schema.parse`
  (`worker/lib/serialize.ts` pattern), identity only from
  `c.get("userEmail")`, ownership gate on every `/:id` route, fakes wired in
  the single `createDeps` branch, e2e via per-test header users — all match the
  house style. HN prompt byte-identical + shared `parseRelevant`/`verdictsFor`
  respects the pinned AI contract in `worker/lib/ai.test.ts`.
- Factual error: **`docs/BACKLOG.md` does not exist.** The repo uses
  `docs/0-backlog/*.md` (one file per idea: `check-scalability.md`, …); the
  root CLAUDE.md reference is stale. §9 should target
  `docs/0-backlog/newsletter-email-sources.md`.
- Naming: `worker/lib/feeds.ts` next to the existing `worker/lib/feed.ts` (HN
  feed loader) is confusable. Acceptable, but consider `feed.ts` staying HN-only
  is worth a one-line note in `worker/CLAUDE.md` when docs are updated (the
  spec already commits to the docs-update rule implicitly; make it explicit in
  the task).
- jscpd `threshold 1` is strict: `formatFeedDigestMessage` and the settings
  page must genuinely share helpers with their HN twins (the spec says so;
  flagging because this check fails builds).
- `publishedAt DESC NULLS LAST` is supported by D1's SQLite; Drizzle will need
  a `sql` fragment — implementation detail, no spec change.
- knip: exported `FeedRow`/`FeedSourceRow`/`FeedItemRow` must each have a
  consumer or `pnpm check` fails — export only what the routes/lib actually
  import.

### Risk / gaps

- **Subrequest budget (the one real platform risk).** A single `runFeedFetch`
  worst-cases at ~10 RSS fetches + ~25 AI batch calls (500 deduped items / 20)
  ≈ 35 — fine alone. But one cron tick runs **all** due feeds (plus due HN
  digests) in one invocation under the 50-subrequest cap: two cold feeds due at
  the same slot can exceed it. Verdict reuse makes the steady state cheap (only
  new items hit AI), and the existing HN cron already accepts the analogous
  multi-user risk, so this is consistent with the codebase's posture — but the
  spec should acknowledge it and prefer **sequential** (not `Promise.all`)
  processing of due feeds in `sendDueFeedDigests`, which bounds nothing but
  degrades gracefully (later feeds fail, earlier ones deliver; per-feed
  try/catch already planned). Non-blocking.
- SSRF/link safety: user-supplied URLs are fetched by the worker (Workers fetch
  cannot reach private networks) and item links are gated by `isHttpUrl` at
  normalization plus `safeHref`/HTML-escaping at both render sinks — consistent
  with the existing ingestion+sink invariant. No change needed.
- `feedsmith` is a real, pure-TS, edge-compatible parser and the spec names a
  fallback with a decision point at implementation time — adequate de-risking
  for a library choice that can only be proven in workerd.

## Open questions (with recommended answers)

1. Where does the backlog note go, given `docs/BACKLOG.md` doesn't exist?
   **Rec:** `docs/0-backlog/newsletter-email-sources.md`, matching the existing
   per-idea file convention.
2. Cron: parallel or sequential over due feeds given the 50-subrequest cap?
   **Rec:** sequential per tick (feeds are few; a tick has 5 minutes of
   headroom), keep per-feed try/catch.
3. Due feed with zero relevant items: send a "nothing matched" message or stay
   silent? **Rec:** send, mirroring `formatDigestMessage`'s empty case — a
   configured slot is an explicit opt-in to a daily message.

## Spec changes (all small, none structural)

1. §9 + Scope: replace `docs/BACKLOG.md` with a new
   `docs/0-backlog/newsletter-email-sources.md`.
2. §3: add a response-size cap to `realRssClient` (reject bodies over a few
   MB) as part of the normalization contract.
3. §5 step 4: state that unsaved items get synthetic ids for the AI pass (the
   judge runs before the upsert).
4. §7: make `sendDueFeedDigests` process due feeds sequentially and note the
   50-subrequest rationale; state the zero-relevant-items message mirrors the
   HN empty case.
5. §1 (optional): `uniqueIndex(feedId, url)` on `feed_sources`.

VERDICT: APPROVED
