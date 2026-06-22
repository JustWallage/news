# src/

- Data fetching: components NEVER call `fetch` directly for reads. Reads go
  through `useCachedFetch(path, schema)` (module-level cache + background
  revalidate); writes go through `apiFetch` from `lib/api.ts`. Everything is
  zod-parsed.
- HomePage has a **Refresh** button → `POST /api/digest/run` (re-curates the
  current user's feed on demand, same endpoint the 06:20 cron uses), then
  re-fetches the feed. HomePage also auto-fires `refresh()` once on mount (a
  `useRef` guard), backend rate-limits once / 5min so cheap.
- Opening a story title fires a fire-and-forget `POST /api/stories/:id/open`
  while the browser follows the link (new tab) — best effort, never blocks nav.
- PreferencesPage seeds the textarea from the server only while it is pristine
  (a `dirty` ref), so a background revalidate can't clobber what is being typed.
- Layout is the plain Hacker-News-style list (orange header, ranked rows).
  Routes: `/` (HomePage, current feed), `/archive` (ArchivePage, displaced
  curations via `GET /api/stories/archive` — its own `useCachedFetch`, NOT in
  `FeedContext`), `/preferences` (PreferencesPage).
- PreferencesPage's `TelegramSection` reads `/api/telegram` status (shows the
  connected chat label), POSTs `/api/telegram/link-code` to reveal a
  `/start <code>` connect code, and POSTs `/api/telegram/test` for the Send test
  message button. When linked, it also shows three `type="time"` inputs (seeded
  pristine via a `slotsDirty` ref, same pattern as the prefs textarea) that PUT
  `/api/telegram/slots`; the editor is hidden until a chat is linked. Times can
  still be set from the bot too. When linked it also shows a Disconnect button →
  `ConfirmDialog` (Base UI `AlertDialog`) → `DELETE /api/telegram`.
- `components/ui/` is shadcn-generated (Base UI primitives, NOT Radix — pass
  `render={<a />}` plus `nativeButton={false}` for a link-button, not `asChild`).
  It is exempt from lint and knip; regenerate via `pnpm dlx shadcn@latest add`.
