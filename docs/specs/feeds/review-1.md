# Review 1 — Feeds feature

Reviewed commit `4f814bf` ("feat: user feeds — RSS sources, per-feed AI
curation, telegram digests") on `claude/feeds-feature-fijvvw`, diffed against
`main`, judged against `docs/specs/feeds/index.md` (including its Decisions
section). Working tree clean.

## Summary

A faithful, well-factored implementation of the spec: new `feeds` /
`feed_sources` / `feed_items` tables in one additive migration, an
`RssClient` seam with feedsmith parsing behind zod re-parse, a feed-specific
AI prompt over a shared `runFilter` core (the HN `SYSTEM_PROMPT` and
`select()` are byte-identical), the full `/api/feeds` surface behind an
ownership gate, send-once Telegram digests off `sentAt` with sequential
per-feed cron processing, maintenance pruning, four new SPA pages, and broad
unit + e2e coverage. Docs (worker/db/shared/src CLAUDE.md) were updated in
the same commit as required.

Two required fixes: the 5 MB RSS cap only rejects after fully buffering the
response (defeating the resource-abuse guard it exists for), and the archive
e2e test's title claims a scenario (items fallen out of the current fetch)
it does not actually exercise.

## Checks

| Check               | Result                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `check:format`      | pass                                                                                                |
| `check:lint`        | pass                                                                                                |
| `check:ts`          | pass                                                                                                |
| `check:knip`        | pass                                                                                                |
| `check:dup` (jscpd) | pass (0 clones)                                                                                     |
| `test:unit`         | pass (18 files, 143 tests)                                                                          |
| `check:tf`          | not run — terraform provider downloads blocked in this container (pre-approved skip, not a finding) |
| `test:e2e`          | run green by the implementer (32 passed); not re-run                                                |

## Findings

### Simplicity — clean, one minor note

The implementation reuses instead of duplicating: `chunk` extracted to
`worker/lib/chunk.ts`, `slotMinutes`/`formatSlots`/`dueSlot` generalized in
`worker/lib/telegram-bot.ts` (existing telegram call sites compile
unchanged), `SlotTimesEditor` extracted from `PreferencesPage` and shared
with feed settings, `runFilter` shared between the HN and feeds AI paths.
No invented abstractions; pages own their state per the ArchivePage pattern.

- Minor (optional): `worker/lib/feeds.ts:251` — `fresh.get(toEvaluate.indexOf(c))`
  inside a `flatMap` over `candidates` is O(n²) per fetch. Bounded (≤500
  items) so harmless today; a `Map<ParsedFeedItem, Verdict>` built once
  would be both simpler and linear.

### Spec implementation — complete, two small deviations noted

Everything in scope is present: schema + migration (`db/migrations/0006_*`),
`shared/api.ts` contracts exactly as specified, RSS seam + fake
(`worker/lib/rss.ts`, `worker/lib/fakes.ts`), feed AI prompt with the
prompt-injection guard mirrored (`worker/lib/ai.ts`), feeds domain lib and
routes, per-feed cooldown 429 + `Retry-After`, cron feed digests with
send-once `sentAt` and the zero-unsent "nothing new" message, 60-day pruning
of never-relevant non-current items, all four SPA pages + nav tab, the
backlog note at `docs/0-backlog/newsletter-email-sources.md`, and no changes
to the HN homepage pipeline, routes, or prompt. Nothing out of scope was
built.

Deviations, none blocking:

- `worker/lib/scheduled.ts:167-173` — spec §7 says to add
  `sendDueFeedDigests` to the existing `Promise.all` in `worker/index.ts`;
  it instead runs sequentially after `sendDueDigests` inside
  `runTelegramDigests`. This better serves the shared 50-subrequest budget
  the same spec section reasons about, and is documented in
  `worker/CLAUDE.md`. Accepted.
- `worker/lib/feeds.ts:197` — the failing-source log carries the source id
  but not the "hashed user tag" the spec mentions. Privacy-safe either way;
  fine.
- `worker/lib/rss.ts:167` — spec says "caps at 50 **newest** per source";
  the code takes the first 50 in document order. RSS convention is
  newest-first so this is equivalent in practice, but a
  `publishedAt`-aware sort before slicing would match the spec exactly.
  Optional.
- `src/pages/FeedPage.tsx:109-114` — the "New feed" button navigates to
  `/feeds` but does not "focus/anchor the create form" (spec §8
  parenthetical). The form is visible on the overview page, so low impact.
  Optional.

### No shortcuts — one required fix

- **REQUIRED** — `worker/lib/rss.ts:187-194`: the 5 MB cap checks
  `Content-Length` (attacker-controlled, often absent on chunked responses)
  and then `body.length` **after** `await res.text()` has already buffered
  the entire response. A hostile or misconfigured source URL can therefore
  stream far more than 5 MB into worker memory before the "guard" fires —
  the exact resource-abuse scenario the spec's SA-round decision added this
  cap for. Fix: read `res.body` incrementally (e.g. `getReader()` loop,
  accumulating decoded chunks) and abort with `RssFetchError("That feed is
too large")` as soon as the running byte count exceeds `MAX_BODY_BYTES`.
  Keep the cheap `Content-Length` pre-check as a fast path. Add a unit test
  if the read loop is extracted as a testable function.

No other shortcuts found: no swallowed errors (the two intentional catches —
per-source fetch failure in `runFeedFetch` and per-feed try/catch in
`sendDueFeedDigests` — both log and are spec-mandated), no stubs or TODOs,
no `as` casts, errors surface user-safe messages end-to-end
(`RssFetchError` → route `{ error }` → `ApiRequestError` → settings UI).

### Code quality — clean

Conventions followed throughout: contracts in `shared/`, responses built via
`schema.parse` (`toFeedItem` in `worker/lib/serialize.ts`), identity only
from `c.get("userEmail")`, chunked upserts (9 bound cols × 10 rows < 100),
D1/subrequest limits respected (`MAX_FEED_SOURCES=10`, one fetch per
source), comments limited to non-obvious WHYs (send-once upsert omission,
synthetic-id ordering, SQLite NULL ordering), docs updated same-commit in
`worker/CLAUDE.md`, `db/CLAUDE.md`, `shared/CLAUDE.md`, `src/CLAUDE.md`.
`FeedContext`/`useFeed` name collision avoided as instructed.

- Minor (optional): `e2e/feeds.spec.ts:34` duplicates a simplified
  `linkChat` already in `e2e/telegram.spec.ts:14` (different return shapes;
  jscpd does not flag it). A shared e2e helper would be slightly tidier.

### Tests — broad, one required fix

Unit coverage matches the spec list: RSS parsing/normalization
(`rss.test.ts`), prefVersion bump-on-change, dedupe across sources, verdict
reuse (AI judged-count assertions), empty-prefs AI-free path, failing-source
survival, `sentAt` preservation, ordering/limit/NULLS-LAST, archive query,
delete cascade (`feeds.test.ts`), ownership 404s, validation 400s, slots
409, source 409s, run 429 (`routes/feeds.test.ts`), due-slot timezone
matching, send-once, no-chat skip (`scheduled.test.ts`), pruning
(`maintenance.test.ts`). e2e covers create→settings→source→prefs→refresh,
overview cards, dropdown switching, failing source, slots link-gating,
delete, and archive.

- **REQUIRED** — `e2e/feeds.spec.ts:161-179`: the test titled "the archive
  keeps items that fell out of the current fetch" never produces a
  fallen-out item — it runs one fetch and asserts two still-current items
  are visible, so it only proves current relevant items appear in the
  archive. The spec's e2e case ("items that fell out of the current top 20
  as well as current ones") is achievable hermetically: run once against
  source A, remove A and add a source on a different host (different item
  links), run again — A's items become `current=false` while staying
  relevant — then assert they still render on the archive page but not the
  feed page. Either strengthen the test that way (preferred; it is a
  spec-listed case) or retitle it to what it actually verifies and rely on
  the unit coverage in `feeds.test.ts` ("archives every relevant item
  ever").

## Action list

Required:

1. `worker/lib/rss.ts:187-194` — enforce `MAX_BODY_BYTES` while streaming
   the response body, not after buffering it; abort past the cap.
2. `e2e/feeds.spec.ts:161-179` — make the archive e2e actually exercise an
   item that fell out of the current fetch (swap sources between two runs),
   or retitle it to match what it verifies.

Optional (no verdict impact):

3. `worker/lib/feeds.ts:251` — replace `toEvaluate.indexOf(c)` with a
   precomputed map.
4. `worker/lib/rss.ts:167` — sort by `publishedAt` before applying the
   50-item cap to match "50 newest".
5. `src/pages/FeedPage.tsx:109-114` — focus/anchor the create form when
   arriving via "New feed".
6. Share a single e2e `linkChat` helper.

VERDICT: CHANGES_REQUESTED
