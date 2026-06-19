# Spec Review: Preference versioning & incremental re-evaluation

## Summary

The implementation faithfully and completely satisfies the spec. The schema gains
`preferences.version`, `curations.relevant`, and `curations.prefVersion` with the
specified defaults; the migration is additive. `PUT /api/preferences` bumps the
version only on a real text change and no-ops on identical text. `runDigest` reuses
verdicts already produced at the current preference version and only sends
unjudged front-page candidates to the AI, persisting non-relevant verdicts so they
are not re-sent at the same version. The `current` (live-feed membership) vs
`relevant` (sticky verdict) invariant is implemented correctly, the version-skip
and feed-recompute logic is correct, the D1 100-bound-parameter cap is respected,
and test coverage (unit, route, e2e) maps directly onto the spec's enumerated
behaviors. The only issue found is a stale inline comment; the code itself is
correct. This is approvable.

## Findings

### Simplicity

- Clean. The version-skip is implemented by querying only the rows at the current
  version (two bound params) rather than an `inArray` over ~100 ids, which both
  stays under the param cap and keeps the reuse map simple. No over-engineering.
- `worker/lib/digest.ts:151-155` — the `fresh` map filters AI verdicts to ids in
  `toEvaluate` (`verdicts.filter((v) => toEvaluate.some((c) => c.id === v.id))`).
  This guards against an AI returning ids it wasn't asked about; it is a defensive
  O(n\*m) filter but n,m are small (≤ front-page size) so it is acceptable. Optional
  micro-simplification: build the map directly from `toEvaluate` ids. Not required.

### Spec implementation

- All data-model changes present and matching the spec defaults
  (`db/schema.ts:35-36,50`; `db/migrations/0001_thick_toro.sql:1-3`).
- Version bump semantics exactly as specified — insert→v1, text differs→prev+1,
  identical→no-op leaving `updatedAt` untouched (`worker/routes/preferences.ts:50-62`).
- Version not exposed in any API response; `GET /api/preferences` unchanged
  (`worker/routes/preferences.ts:26-29`). Confirmed no other consumer reads `version`.
- `loadPreferences` returns `{ text, version }` with `version: 0` for no row
  (`worker/lib/digest.ts:51-62`); both callers pass `prefs.text` + `prefs.version`
  (`worker/routes/digest.ts:16-23`, `worker/lib/scheduled.ts:21`).
- `runDigest` algorithm matches steps 1-6: chunked story upsert, load prior rows at
  current version, evaluate only the unjudged subset, reuse/fresh/skip-unwritten
  verdict build, feed reset + chunked upsert with `current = relevant`, `count` =
  relevant count (`worker/lib/digest.ts:84-226`). `count` still satisfies
  `digestRunResultSchema` (`shared/api.ts:53`).
- Empty-prefs fallback unchanged in spirit — top-30 by score, AI-free, always
  recomputed, no non-relevant rows persisted (`worker/lib/digest.ts:122-133`).
- `AiFilter` interface unchanged. Confirmed.

### No shortcuts

- No hacks, swallowed errors, stubs, or TODOs. The "AI returned no verdict" case is
  handled per spec by leaving the candidate unwritten so it retries next run
  (`worker/lib/digest.ts:169-182`), rather than fabricating a verdict.
- Migration is additive `ADD COLUMN` only; no edits to the shipped `0000`
  migration; journal/meta are consistent (`db/migrations/meta/_journal.json`).
- Off-front-page archive rows at the current version are correctly left untouched:
  `priorRows` is unfiltered by candidate id, but both `toEvaluate` and `evaluated`
  iterate `candidates` only, so extra reusable entries never re-enter the feed and
  stay `current = false` from the reset. Correct, matches "never re-evaluate older
  stories."

### Code quality

- Clear naming (`reusable`, `toEvaluate`, `fresh`, `evaluated`), consistent with the
  surrounding style. Logging mirrors the existing `[digest]` pattern.
- `worker/lib/digest.ts:33` — STALE COMMENT. The chunk comment reads "stories have 8
  columns, curations 7 → 10 rows/insert is safe." Curations now bind 9 columns
  (the very next comment at line 35 says so). Fix line 33 to say curations bind 9
  columns (or drop the curations count from this comment since line 35 owns it) so
  the two adjacent comments don't contradict. Cosmetic, but the repo's docs rule
  forbids stale narration.

## Action list (prioritized)

1. Fix the contradictory/stale bound-parameter comment at `worker/lib/digest.ts:33`
   ("curations 7") to reflect the current 9 bound columns, consistent with the
   comment at line 35. (Cosmetic; not behavior-affecting.)

VERDICT: APPROVED
