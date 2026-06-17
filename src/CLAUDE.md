# src/

- Data fetching: components NEVER call `fetch` directly for reads. Reads go
  through `useCachedFetch(path, schema)` (module-level cache + background
  revalidate); writes go through `apiFetch` from `lib/api.ts`. Everything is
  zod-parsed.
- HomePage has a **Refresh** button → `POST /api/digest/run` (re-curates the
  current user's feed on demand, same endpoint the 06:20 cron uses), then
  re-fetches the feed.
- Opening a story title fires a fire-and-forget `POST /api/stories/:id/open`
  while the browser follows the link (new tab) — best effort, never blocks nav.
- PreferencesPage seeds the textarea from the server only while it is pristine
  (a `dirty` ref), so a background revalidate can't clobber what is being typed.
- Layout is the plain Hacker-News-style list (orange header, ranked rows). Two
  routes only: `/` (HomePage) and `/preferences` (PreferencesPage).
- `components/ui/` is shadcn-generated (Base UI primitives, NOT Radix — pass
  `render={<a />}` plus `nativeButton={false}` for a link-button, not `asChild`).
  It is exempt from lint and knip; regenerate via `pnpm dlx shadcn@latest add`.
