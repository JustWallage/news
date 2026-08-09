# src/

- Data fetching: components NEVER call `fetch` directly for reads. Reads go
  through `useCachedFetch(path, schema)` (module-level cache + background
  revalidate); writes go through `apiFetch` from `lib/api.ts`. Everything is
  zod-parsed.
- HomePage has a **Refresh** button → `POST /api/digest/run` (re-curates the
  current user's feed on demand), then re-fetches the feed. HomePage also
  auto-fires `refresh()` once on mount (a `useRef` guard); the backend
  rate-limits HN fetches to once / 5min so it's cheap. While `refreshing`
  spinner above posts.
- `AuthGate` renders `LandingPage` (the unauthenticated explainer + sign-in CTA)
  when `/api/health` 401s; authenticated `/` is the feed. The sign-in CTA lives
  in `LandingPage` and reads `GET /auth/config`: when `turnstileSiteKey` is set it
  renders the Cloudflare Turnstile widget and the sign-in button passes the token
  to `/auth/login?cf-turnstile-response=…`; when null (local/e2e) it falls back to
  a plain button → `/auth/login`. PreferencesPage has a Log out button →
  `POST /auth/logout`.
- `/demo` is a PUBLIC route OUTSIDE `AuthGate` (see `App.tsx`: `AuthGate` now
  wraps only the `Layout` route element, so `/demo` renders for anyone).
  `DemoPage` reads `GET /public/feed` (`demoFeedSchema`) — the owner's live feed
  — and is READ-ONLY: it reuses `StoryRow` with no `onOpen` (no open-tracking)
  and no Refresh. It also shows the owner's `preferences` in a read-only textarea
  ("Based on these preferences:"), hidden when empty. The landing page's "Show
  live demo" button links here.
- `StoryRow` props are a structural subset of `Story` (+ optional `openedAt`,
  optional `onOpen`) so the public demo can pass a `PublicStory`; the feed/archive
  still pass a full `Story`.
- `StoryRow` links go through `safeHref` (`lib/format.ts`): only http(s) story
  URLs are used as the anchor target, else it falls back to the HN item page —
  React does not block dangerous href schemes, so never bind `story.url` raw.
- Opening a title fires a fire-and-forget `POST <base>/:id/open` via
  `useRecordOpen(basePath, mutate)` while the browser follows the link (new tab)
  — best effort, never blocks nav. A read row (`openedAt !== null`) renders
  `text-muted-foreground` in both `StoryRow` and `FeedItemRow`. Each list passes
  ITS OWN `mutate` (HN feed, HN archive, feed items, feed archive are separate
  cache entries), so the clicked row greys in place instead of waiting for a
  reload; the feeds base path is always `/api/feeds/:feedId/items`, archive
  included.
- PreferencesPage seeds the textarea from the server only while it is pristine
  (a `dirty` ref), so a background revalidate can't clobber what is being typed.
- Layout is the plain Hacker-News-style list (orange header, ranked rows).
  Routes: `/` (HomePage, current feed), `/archive` (ArchivePage — every story
  ever shown, current feed included, most recently shown first, via
  `GET /api/stories/archive`; its own `useCachedFetch`, NOT in `FeedContext`),
  `/preferences` (PreferencesPage).
- PreferencesPage's `TelegramSection` reads `/api/telegram` status (shows the
  connected chat label), POSTs `/api/telegram/link-code` to reveal a
  `/start <code>` connect code, and POSTs `/api/telegram/test` for the Send test
  message button. When linked, it also shows three `type="time"` inputs (seeded
  pristine via a `slotsDirty` ref, same pattern as the prefs textarea) that PUT
  `/api/telegram/slots`; the editor is hidden until a chat is linked. Times can
  still be set from the bot too. When linked it also shows a Disconnect button →
  `ConfirmDialog` (Base UI `AlertDialog`) → `DELETE /api/telegram`. A timezone
  selector (native `<select>` from `Intl.supportedValuesOf`, seeded via a
  `tzDirty` ref, always shown) saves on change via `PUT /api/telegram/timezone`;
  the link-code POST also carries the selected zone, so the browser-detected
  default and the editor never diverge.
- Feeds pages (`/feeds`, `/feeds/:feedId`, `/feeds/:feedId/archive`,
  `/feeds/:feedId/settings`): `FeedContext`/`useFeed` belong to the HN feed —
  feeds pages own their `useCachedFetch` state instead (the ArchivePage
  pattern) and have their OWN Refresh (`POST /api/feeds/:id/run`; the header
  Refresh stays HN-only). Switching feeds goes ONLY through `/feeds` (the
  overview cards) — there is no feed picker on a feed page; the feed page links
  to `/feeds`, and archive/settings link back to `/feeds/:feedId`.
  Feed settings renders each source as a `Card` (title, URL, fetched/selected
  counts) whose body is a button opening `SourceItemsDialog` — a Base UI
  `Dialog` (same hand-rolled pattern as `ConfirmDialog`, which uses
  `AlertDialog`) that reads `GET /api/feeds/:id/sources/:sourceId/items` and is
  mounted only while open, so the fetch follows the click. Removing a source
  goes through a `ConfirmDialog` first (one dialog for the page, keyed off a
  `removeSourceId` state), as does deleting the feed.
  `FeedItemRow` is the lean item
  row (`StoryRow` is HN-shaped — don't reuse it). `SlotTimesEditor` is the
  shared three-time-inputs editor (TelegramSection + feed settings); parents
  own state/dirty/save. `ApiRequestError` is exported so callers can branch on
  status (FeedPage shows a friendly 429) and carries the server's `{ error }`
  message when present (feed settings shows it for add-source failures).
- `components/ui/` is shadcn-generated (Base UI primitives, NOT Radix — pass
  `render={<a />}` plus `nativeButton={false}` for a link-button, not `asChild`).
  It is exempt from lint and knip; regenerate via `pnpm dlx shadcn@latest add`.
