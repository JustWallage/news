# Review 1 — Per-user timezone for the Telegram daily feed

## Summary

The branch implements all five in-scope requirements faithfully and stays within
scope (owner-only cron, web digest, and DST edge cases untouched as specified).
`pnpm check` passes green (67 unit tests, format/lint/types/knip/jscpd/terraform).
The code matches repo conventions: no `as` casts, shared schemas as contracts,
nullable column with Amsterdam fallback, native `<select>` (no new dep), and the
`parseJsonBody` duplication was extracted to `lib/http.ts` exactly as the design
called for. Tests cover every new behaviour. One non-blocking copy nit noted.

## Findings per axis

### Faithful spec implementation — clean

All seven design sections are present and match the spec:

- Schema migration `db/migrations/0003_peaceful_blade.sql` adds nullable
  `timezone text`, generated (not hand-written); table comment updated.
- `shared/api.ts` adds `isValidTimeZone` refine + `telegramTimezoneSchema`, and
  extends `telegramStatusSchema` with `timezone`.
- `worker/lib/time.ts:27` renames to `minuteOfDayInTz(now, timeZone)`;
  `amsterdamMinuteOfDay` removed (no orphan, knip green); `amsterdamHour`/
  `amsterdamDate` left intact.
- `mintLinkCode` persists timezone on insert and `onConflictDoUpdate.set`;
  `saveTimezone` upsert works pre-link; `loadTelegramStatus` returns it;
  `handleStart` adds the timezone line only when non-null
  (`telegram-bot.ts:188`), preserving the `toContain("Linked")` assertion.
- `scheduled.ts:68` uses `minuteOfDayInTz(now, row.timezone ?? "Europe/Amsterdam")`.
- `telegram.ts` parses `POST /link-code` body, adds `PUT /timezone`, both with
  the `safeParse → 400` pattern.
- `PreferencesPage.tsx` reads `data.timezone`, seeds from server-or-detected with
  the `tzDirty` ref guard mirroring the interests textarea, renders a native
  `<select>` from `Intl.supportedValuesOf`, saves on change + `mutate()`, and
  `connect()` sends the selector's current value.

### Simplicity — clean

Simplest correct approach throughout. Nullable column + `?? "Europe/Amsterdam"`
fallback avoids a backfill. One shared schema validates both bodies. No radix
dep added. The dirty-ref pattern reuses an existing convention rather than
inventing state machinery.

### No shortcuts / hacks — clean

No stubs, TODOs, or swallowed errors that hide failures. The two `.catch(() => {})`
blocks in the frontend (clipboard, timezone save) are deliberate UX no-ops with
inline comments, consistent with the existing copy-button handler — not hidden
error swallowing. Invalid timezones are rejected server-side with 400 via the
`Intl` refine, and the same validation runs browser-side.

### Code quality — clean

Matches conventions: schema-derived types across boundaries, no casts, comments
only where non-obvious (the dirty-ref guard, the off-slot early return). Both
`CLAUDE.md` files updated in the same change (invariant + grep pointers), as the
docs standard requires.

### Tests — clean

- `time.test.ts`: one instant resolved into Amsterdam/New York/Tokyo plus a DST
  winter case.
- `telegram-bot.test.ts`: timezone threaded through `mintLinkCode`, `/start`
  reply asserted to contain the zone, stored zone asserted, and `saveTimezone`
  insert-then-update on a chat-less user.
- `scheduled.test.ts`: fires on the local (NY) minute and not the Amsterdam
  minute, plus the null-tz Amsterdam-fallback case.
- `api.test.ts`: link-code stores the zone, invalid zone → 400, `PUT /timezone`
  sets + reflected in `GET /`, invalid body → 400.
- `e2e/telegram.spec.ts`: selector visible, selecting a zone PUTs and persists
  across reload; existing generate→copy flow retained.

## Non-blocking observation

`src/pages/PreferencesPage.tsx:140` — selector helper text reads "Your daily
summaries are sent at the times above in this timezone." The slot times
(`when`) only render when `linked` is true, so for an unlinked user there are no
"times above." Minor copy imprecision, not a functional defect. Optional fix:
soften to "Daily summaries are sent in this timezone." Not required for approval.

## Action list

None required.

VERDICT: APPROVED
