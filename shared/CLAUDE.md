# shared/

Single source of truth for every type that crosses the worker/frontend
boundary. Change the schema here FIRST; both sides follow via `z.infer`.

- `api.ts` — request/response schemas. `storySchema` is a feed item (story
  content from the `stories` cache + this user's curation fields:
  relevanceScore, reason, openedAt). `preferencesUpdateSchema` is the PUT body;
  `digestRunResultSchema` is the Refresh/`/api/digest/run` result.
  `telegramStatusSchema` (linked + `chatLabel` + 3 `HH:MM`|null slots),
  `telegramSlotsUpdateSchema` (the `PUT /api/telegram/slots` body — 3 `HH:MM`|null
  slots) and `telegramLinkCodeSchema` (code + `t.me` url + expiry) back the
  `/api/telegram` routes. `authConfigSchema` backs `GET /auth/config` (the SPA
  reads `turnstileSiteKey`). `publicStorySchema` (`storySchema.pick` of the
  HN-public fields only — never the per-user `openedAt`/`relevanceScore`/`reason`)
  and `demoFeedSchema` (`{ stories, preferences, lastCuratedAt }` — `preferences`
  is the owner's plain-text interests shown on the demo) back the anonymous
  `GET /public/feed` demo; deriving from `storySchema` keeps a future private
  field from ever leaking onto the public surface.
  `preferencesUpdateSchema` caps text at the shared
  `PREFERENCES_MAX_LENGTH` (1000) — the same cap the Telegram path enforces.
  `isHttpUrl` is the shared scheme guard both render sinks (SPA anchor, Telegram
  href) and HN ingestion use so a non-http(s) URL never reaches an href.

No imports from worker/ or src/ — this folder must stay dependency-free
(zod only) since both tsconfig projects include it.
