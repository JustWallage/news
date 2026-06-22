# Per-user timezone for the Telegram daily feed

## Request (verbatim)

> Add the user's timezone when they generate the telegram code. Also, when
> they've successfully connected their telegram account, send them a telegram
> message and include their timezone in there as well.

> Also include using the user's timezone for their telegram daily scheduled
> messages. Also make the timezone configurable from their preferences screen.

## Context

The app is being opened to the public. Today all Telegram scheduling is
hardcoded to `Europe/Amsterdam`: the `*/5` heartbeat compares the current
_Amsterdam_ minute-of-day against the user's stored slots
(`worker/lib/scheduled.ts:67`), and slot times entered via `/daily_time` are
interpreted as Amsterdam-local. There is no per-user timezone stored anywhere.

The browser is the only viable timezone source — auth is Cloudflare Access,
which gives the worker only an email, and standard OIDC has no reliable
timezone claim. `Intl.DateTimeFormat().resolvedOptions().timeZone` yields an
accurate IANA zone (e.g. `"America/New_York"`).

## Scope

### In scope

1. Store a per-user IANA `timezone` on the `telegram` row.
2. Capture it when the user generates a link code (the frontend sends the
   timezone currently shown in the preferences selector).
3. Echo the timezone in the `/start <code>` success message.
4. **Use the stored timezone for the daily scheduled Telegram messages** — slot
   matching runs against the user's local minute-of-day, not Amsterdam's.
5. **A timezone selector on the preferences screen** — auto-detected default,
   editable, persisted.

### Explicitly OUT of scope

- The removed 06:20 web digest (handled on another branch — ignore here; its
  `runScheduledDigest` / `amsterdamHour` path stays untouched).
- Multi-user iteration of the Telegram cron: `runTelegramDigests` still serves
  only the owner (`ALLOWED_EMAILS[0]`). This change makes _that owner's_
  schedule timezone-aware; fanning out to many users is a separate concern.
- DST gap/overlap edge cases for slots (spring-forward skip / fall-back double).

## Current behaviour (verified files)

- `db/schema.ts` — `telegram` table keyed by `userEmail`; columns `chatId`,
  `chatUsername`, `chatName`, `linkCode`, `linkCodeExpiresAt`, `slot1..3`. No
  timezone column.
- `worker/lib/time.ts` — `amsterdamDate`, `amsterdamHour`, `amsterdamMinuteOfDay`
  (each hardcodes `TZ = "Europe/Amsterdam"` via `Intl.DateTimeFormat`).
  `amsterdamMinuteOfDay` is used **only** by `runTelegramDigests`.
- `worker/lib/scheduled.ts` — `runTelegramDigests(env, now)` loads the owner's
  telegram row and fires when `dueSlot(row, amsterdamMinuteOfDay(now))`.
- `worker/lib/telegram-bot.ts` — `mintLinkCode(db, userEmail, now)`;
  `handleStart` replies `` `✅ Linked! I'll send your daily summaries here.\n\n${HELP}` ``;
  `loadTelegramStatus` returns `{ linked, chatLabel, slots }`.
- `worker/routes/telegram.ts` — `POST /link-code` ignores its body;
  `GET /` returns status; `POST /test` sends a test message.
- `worker/routes/preferences.ts` — defines a private `parseJsonBody(req)` and the
  `safeParse(...) → 400` request-body pattern.
- `shared/api.ts` — `telegramStatusSchema` (`linked`, `chatLabel`, `slots`),
  `telegramLinkCodeSchema` (response). No request-body schema.
- `src/pages/PreferencesPage.tsx` — `TelegramSection`; `connect()` POSTs an empty
  body. `src/components/ui/` has only button/card/label/textarea (no Select).

## Design

### 1. Schema + migration (`db/schema.ts`)

Add a nullable column to `telegram`:

```ts
timezone: text("timezone"),
```

Nullable so pre-existing rows stay valid and scheduling can fall back. Update the
table comment. Generate the SQL with `pnpm migrate:gen` (produces
`db/migrations/0003_*.sql` + meta snapshot/journal). Never hand-write it.

### 2. Shared schema (`shared/api.ts`)

Add an IANA-timezone validator and reuse it. Both worker (Workers runtime) and
browser have `Intl`, so the refine runs on both sides:

```ts
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
const timeZoneString = z
  .string()
  .refine(isValidTimeZone, "invalid IANA time zone");

// Request body for both POST /link-code and PUT /timezone (same shape).
export const telegramTimezoneSchema = z.object({ timezone: timeZoneString });
```

Extend the status response with the stored zone:

```ts
export const telegramStatusSchema = z.object({
  linked: z.boolean(),
  chatLabel: z.string().nullable(),
  slots: z.array(z.string().nullable()).length(3),
  timezone: z.string().nullable(),
});
```

### 3. Time library (`worker/lib/time.ts`)

Add a timezone-parameterized minute-of-day and **remove** the now-unused
`amsterdamMinuteOfDay` (it has no other callers; leaving it trips knip):

```ts
export function minuteOfDayInTz(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return (get("hour") % 24) * 60 + get("minute");
}
```

Keep `amsterdamHour` and `amsterdamDate` untouched (still used elsewhere).

### 4. Worker — store, save, echo (`worker/lib/telegram-bot.ts`)

- `mintLinkCode(db, userEmail, timezone, now)` — persist `timezone` on both
  insert and `onConflictDoUpdate.set` (latest generate wins; the frontend always
  sends the selector's current value, so this never clobbers an explicit choice).
- New `saveTimezone(db, userEmail, timezone)` — upsert just the timezone:
  `insert({ userEmail, timezone }).onConflictDoUpdate({ target: userEmail, set: { timezone } })`.
  Works before linking (row may not exist yet).
- `loadTelegramStatus` — include `timezone: row?.timezone ?? null`.
- `handleStart` — when the resolved row's `timezone` is non-null, add a line:

  ```
  ✅ Linked! I'll send your daily summaries here.
  Your timezone is set to {timezone}.

  {HELP}
  ```

  When null, omit the line (keeps the existing `toContain("Linked")` assertion).

### 5. Worker — scheduling (`worker/lib/scheduled.ts`)

Swap the Amsterdam minute for the user's local minute, defaulting to Amsterdam
when unset:

```ts
if (!dueSlot(row, minuteOfDayInTz(now, row.timezone ?? "Europe/Amsterdam"))) {
  return;
}
```

Update the import (`minuteOfDayInTz` replaces `amsterdamMinuteOfDay`).

### 6. Worker — routes (`worker/routes/telegram.ts`)

- Extract `parseJsonBody` into a shared `worker/lib/http.ts` and import it in both
  `telegram.ts` and `preferences.ts` (removes the duplication the SA flagged for
  jscpd).
- `POST /link-code` — parse the body with `telegramTimezoneSchema`
  (`safeParse(await parseJsonBody(c.req.raw))` → 400 on failure), pass
  `timezone` to `mintLinkCode`.
- New `PUT /timezone` — same parse/400 pattern; call `saveTimezone`; return
  `c.json({ ok: true })`.

### 7. Frontend (`src/pages/PreferencesPage.tsx`, `TelegramSection`)

- Read `data.timezone` from the status query.
- Local `timezone` state seeded from `data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone`;
  follow the existing dirty-ref pattern (the "Your interests" textarea) so a
  background revalidate doesn't clobber an in-flight choice.
- Render a native `<select>` (no shadcn Select exists; avoid adding a radix dep)
  populated from `Intl.supportedValuesOf("timeZone")`, labelled "Timezone".
  `onChange`: set state, `PUT /api/telegram/timezone` with `{ timezone }`, then
  `mutate()` the status query. Show the selector whether or not the chat is
  linked.
- `connect()` — send `jsonInit("POST", { timezone })` using the selector's
  current value (so generate and the editor always agree).

## Tests

### Unit — `worker/lib/time.test.ts`

Replace `amsterdamMinuteOfDay` cases with `minuteOfDayInTz` cases: one UTC
instant resolved into ≥2 zones (e.g. Amsterdam vs `America/New_York` vs
`Asia/Tokyo`) and a DST instant, asserting the minute-of-day differs correctly.

### Unit — `worker/lib/telegram-bot.test.ts`

- Pass a timezone to every `mintLinkCode(db, USER, "America/New_York", new Date())`.
- Assert the `/start` reply contains the timezone string.
- Assert the minted row stores the timezone.
- Cover `saveTimezone` (upsert sets/updates the column; works on a fresh user).

### Unit — `worker/lib/scheduled.test.ts`

- Set `timezone` on the telegram fixture and assert the digest fires when the
  **local** minute matches the slot and not when only the Amsterdam minute would.
- One case with `timezone = null` confirming the Amsterdam fallback still fires.

### Route — `worker/routes/api.test.ts`

- `POST /link-code` with `{ timezone: "America/New_York" }`; assert stored value;
  invalid timezone body → 400.
- `PUT /timezone` sets the column; invalid body → 400; `GET /` returns it.

### e2e — `e2e/telegram.spec.ts`

- Existing generate→copy flow still passes (frontend now sends the detected
  timezone).
- Add: the Timezone selector is visible with a value; selecting a different zone
  persists across reload (covers the configurable-UI logic end-to-end).

## Verification

- `pnpm check` green (format, lint, types, knip, jscpd, terraform, unit).
- `pnpm test:e2e` green.

## Decisions

- **[AI]** Timezone source = browser `Intl.DateTimeFormat().resolvedOptions().timeZone`; only viable source (Access exposes email only).
- **[AI]** Storage = nullable `timezone` column on the `telegram` table (migration 0003); scheduling falls back to `Europe/Amsterdam` when null.
- **[AI]** One shared `telegramTimezoneSchema` (`{ timezone }`) validates both the link-code body and the new `PUT /timezone` body; validation via an `Intl` try/catch refine; invalid → 400 (mirrors `preferences.ts`).
- **[AI]** Slot scheduling switched from `amsterdamMinuteOfDay` to `minuteOfDayInTz(now, row.timezone ?? "Europe/Amsterdam")`; `amsterdamMinuteOfDay` removed (no other callers); `amsterdamHour`/`amsterdamDate` untouched.
- **[AI]** Editor control = native `<select>` from `Intl.supportedValuesOf("timeZone")`, saved on change — no new UI dependency, consistent with the repo's hand-rolled components.
- **[AI]** "Generate" sends the selector's current timezone (not a fresh detect) so generate and the editor never disagree; mint overwrites on re-generate.
- **[AI]** `parseJsonBody` extracted to `worker/lib/http.ts`, shared by both routes, to avoid a jscpd finding.
- **[AI]** Owner-only Telegram cron is unchanged (multi-user fan-out out of scope).
