# .github/

Trunk-based pipeline; reusable jobs via `workflow_call`.

- Push to `main` → deploy.yml: check-and-build → terraform apply →
  ephemeral-e2e → deploy-prod (concurrency group `deploy-prod`, gated on green
  E2E). Put `-skip-e2e` in the commit title to skip the E2E stage.
- Feature branches run nothing unless the commit title contains `run-pipeline`
  → branch-pipeline.yml (checks + ephemeral E2E, no deploy).
- Ephemeral E2E deploys worker + D1 named `news-e2e-<run_id>`
  (`TEMPLATE_E2E_DB_ID` in wrangler.jsonc is sed-replaced) and ALWAYS tears both
  down, also on failure. The prod D1 id comes from the terraform job output and
  replaces `TEMPLATE_PROD_DB_ID`. The internet-reachable ephemeral worker also
  gets a per-run `TELEGRAM_WEBHOOK_SECRET` (the committed `e2e-webhook-secret` is
  sed-replaced with `openssl rand` and handed to Playwright via
  `E2E_WEBHOOK_SECRET`), so no publicly-known secret gates it.
- Builds select the wrangler env via `CLOUDFLARE_ENV`; deploys use the generated
  `dist/news/wrangler.json`, not the root config.
- Required repo secrets (set by `scripts/bootstrap.sh`): CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN, CLOUDFLARE_R2_ACCESS_KEY_ID,
  CLOUDFLARE_R2_SECRET_ACCESS_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  TEST_AUTH_TOKEN, WORKERS_DEV_SUBDOMAIN, CUSTOM_DOMAIN_ZONE_ID.
- Optional repo secrets the `deploy-prod` job pushes onto the worker via
  `wrangler secret put` after deploy (each skipped when unset): the Telegram pair
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` (bot stays disabled when unset)
  and the Turnstile pair `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` (sign-in
  bot-gate stays off when unset).
- `dependabot.yml` opens weekly npm + github-actions update PRs (security updates
  arrive immediately) — the standing dependency-scanning gate.
