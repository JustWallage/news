# Preference versioning & incremental re-evaluation

## Original request (verbatim)

> when a user edits their preference, an atomical counter (version) should be
> increased, then, with each story that is evaluated, you must store the atomical
> counter of the preference that was used for it. then, when the user clicks
> refresh, for all current HN items from the Algolia api it should reevaluate the
> ones that were evaluated using an older preference version than the current
> version of the user's preference. this should really only happen for the
> current top HN stories (so from the Algolia query), and not for any older
> stories.

## Problem

Every digest run (the 06:20 cron and the homepage Refresh button) currently
re-runs the Workers AI relevance filter over **all** ~100 front-page candidates,
even when the user's preferences have not changed since the last run. That is
wasted AI work (cost + latency). We want a refresh to only (re-)evaluate
front-page stories that have **not** already been judged against the user's
**current** preferences.

## Solution overview

Give each user's preferences a monotonic **version** counter, bumped on every
save. Stamp every evaluated story (per user) with the preference version that
produced its verdict. On a digest run, only send a candidate to the AI when it
has no verdict at the current preference version; reuse the stored verdict
otherwise. Re-evaluation is scoped to the current Algolia front page only —
older curated stories that have dropped off the front page are never
re-evaluated.

## Data model changes (`db/schema.ts` + new migration)

- `preferences.version` — `integer NOT NULL DEFAULT 1`. The atomic counter.
- `curations.relevant` — `integer` boolean (`{ mode: "boolean" }`)
  `NOT NULL DEFAULT true`. The AI/fallback verdict for this story. Needed
  because we now persist **non-relevant** evaluations too (so we can remember
  they were judged at a given version and skip them next time).
- `curations.prefVersion` — `integer NOT NULL DEFAULT 0`. The preference version
  used to evaluate this story for this user.

Migration is generated via `pnpm migrate:gen` (additive `ALTER TABLE … ADD
COLUMN` with the defaults above so existing rows stay valid). Defaults exist
only to make the migration valid on pre-existing rows; the digest always writes
all three explicitly.

### Invariant: `current` vs `relevant`

- `relevant` is the **sticky verdict** — set when a story is evaluated, carried
  forward when its verdict is reused.
- `current` is **live-feed membership**, recomputed every run: `current = true`
  iff the story is in the latest front-page candidate set **and** `relevant`.
- The feed query is unchanged: `current = true` (which now implies `relevant`).

## Version counter (`worker/routes/preferences.ts`)

`PUT /api/preferences` bumps the version only when the text actually changes:

- No existing row → insert with `version = 1`.
- Existing row, **text differs** → update `text` + `updatedAt`, set
  `version = previous + 1`.
- Existing row, **text identical** → no-op (re-saving the same text neither
  bumps the version nor triggers a needless re-evaluation; `updatedAt` is left
  unchanged).

This requires reading the current row before writing. The single-user, sequential
nature of the app makes the read-then-write safe (no concurrent writers race the
counter).

The version is **not** exposed in any API response — it is purely internal state
driving the digest. `GET /api/preferences` is unchanged (`{ text, updatedAt }`).

## Digest changes (`worker/lib/digest.ts`)

`loadPreferences` now returns `{ text: string; version: number }` (version `0`
when the user has no preferences row). `runDigest` gains the version:
`runDigest(db, deps, prefsText, prefVersion, userEmail, now)`. Callers
(`routes/digest.ts`, `lib/scheduled.ts`) pass `prefs.text` and `prefs.version`.

New algorithm (preferences non-empty / AI path):

1. Fetch the front page once (`hn.frontPage()`), upsert into `stories` (chunked,
   unchanged).
2. Load this user's existing curations for the candidate ids: their
   `prefVersion`, `relevant`, `relevanceScore`, `reason`, `curatedAt`.
3. A candidate **needs evaluation** unless it already has a curation whose
   `prefVersion === currentVersion`. Send only the needs-evaluation subset to
   `ai.select(prefs, subset)`.
4. Build the verdict for every candidate:
   - reused (curation at current version) → keep its `relevant`, `relevanceScore`,
     `reason`, `curatedAt`.
   - freshly evaluated → use the AI verdict; `curatedAt = now`.
   - a needs-evaluation candidate the AI returned **no** verdict for is left
     unwritten (no current-version row), so it is retried on the next refresh.
5. Reset the user's feed (`current = false` for all their curations), then upsert
   every candidate that has a verdict (relevant **and** non-relevant) with
   `relevant`, `relevanceScore`, `reason`, `prefVersion = currentVersion`,
   `curatedAt`, `current = relevant`, preserving `openedAt`. Chunked to respect
   the D1 100-bound-parameter cap (curations now have 9 columns → 10 rows/insert
   = 90 < 100).
6. `count` = number of relevant candidates (the new feed size), unchanged
   contract (`digestRunResultSchema`).

Empty-preferences fallback is unchanged in spirit: top `UNFILTERED_FALLBACK` (30)
candidates by score, stored as `relevant = true`, `relevanceScore = 0`,
`reason = ""`, `prefVersion = currentVersion`, `current = true`. The fallback is
AI-free, so it always recomputes (no version-skip) and does not persist
non-relevant rows.

Stories not in the current candidate set keep whatever curation they had but are
dropped from the feed (`current = false`) — they are never re-evaluated, matching
"only the current top HN stories, not any older stories."

The `AiFilter` interface is **unchanged** — version-skip logic lives entirely in
`runDigest`, which decides which stories reach `ai.select`.

## Frontend

No UI changes. The feature is driven by the existing Save (preferences edit) and
Refresh actions.

## Testing

Unit (`worker/lib/digest.test.ts`, real workerd D1) — the precise behavior:

- A counting `AiFilter` records how many stories it is asked to evaluate per run.
- Run at version 1 over the front page → all candidates evaluated.
- Re-run at the **same** version with the same front page → the AI is asked to
  evaluate **0** stories (all verdicts reused); the feed is identical.
- Re-run at a **higher** version → all front-page candidates are evaluated again.
- A new story appearing on the front page at the same version is evaluated while
  the already-judged ones are skipped.
- Non-relevant verdicts are persisted (a previously-irrelevant front-page story
  is not re-sent to the AI at the same version).
- Existing invariants still hold: `openedAt` preserved, per-user isolation,
  empty-prefs fallback, chunking across many stories.

Route (`worker/routes/api.test.ts`):

- Editing preferences (PUT) then refreshing re-curates against the new text
  (version bump path through the real route surface).

E2E (`e2e/`):

- Set prefs to "rust" → Refresh → the Bitcoin story is **not** shown (Rust is).
  Update prefs to "bitcoin" → Refresh → the Bitcoin story now **is** shown. This
  exercises the version bump on edit driving re-evaluation of a front-page story
  that was previously judged non-relevant.

## Docs

Update `worker/CLAUDE.md` and `db/CLAUDE.md` for the new columns, the
`current` vs `relevant` invariant, the version counter, and the version-skip
behavior of `runDigest`.
