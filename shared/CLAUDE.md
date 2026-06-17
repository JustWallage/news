# shared/

Single source of truth for every type that crosses the worker/frontend
boundary. Change the schema here FIRST; both sides follow via `z.infer`.

- `api.ts` — request/response schemas. `storySchema` is a feed item (story
  content from the `stories` cache + this user's curation fields:
  relevanceScore, reason, openedAt). `preferencesUpdateSchema` is the PUT body;
  `digestRunResultSchema` is the Refresh/`/api/digest/run` result.

No imports from worker/ or src/ — this folder must stay dependency-free
(zod only) since both tsconfig projects include it.
