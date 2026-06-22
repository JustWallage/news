# Rate-limit on-demand digests now that sign-up is public

Since the app is open to the public, any signed-in user can trigger a Workers AI
pass via `POST /api/digest/run` (homepage Refresh / Telegram `/fetch`). There is
no per-user rate limit, so a user could spam refreshes and run up Workers AI cost.

Add a cheap per-user throttle (e.g. reuse the existing 5-min `RATE_LIMIT_MS`
front-page reuse, or a per-user last-run timestamp) so a refresh that nothing has
changed is a no-op or 429.

Related: the `*/5` Telegram cron now fans out per due user within one invocation
(`fetchFrontPage` once, then `curateForUser` + send in parallel). Workers Free
caps subrequests at 50 per invocation, so once there are many users due in the
same minute this can hit the ceiling — consider batching or spreading slots.
