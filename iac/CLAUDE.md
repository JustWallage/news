# iac/

Terraform owns: prod D1, the Access application + Google IdP (the ONLY place the
allowed-email lives), and a path-scoped Access app that **bypasses** Access for
`/telegram/webhook` (Telegram cannot authenticate; the worker checks a secret
token instead). Wrangler/CI own: the worker itself, its secrets (including the
Telegram bot token + webhook secret, set manually — see BOOTSTRAP), migrations,
the **Workers custom domain** (production `routes` in wrangler.jsonc), and all
ephemeral e2e resources — never add those to Terraform.

The custom domain is NOT a Terraform resource on purpose: Terraform runs before
the worker is deployed, so Wrangler creates it at deploy time

- State: R2 bucket `news-tfstate` (S3 backend; endpoint passed via
  `-backend-config` at init because backend blocks can't interpolate vars).
- Local validation only: `pnpm tf:init` (no backend) once, then `pnpm check`
  covers fmt+validate. Applies happen exclusively in the deploy pipeline.
- `custom_domain` defaults to `news.justwallage.nl`; the Access app is gated on
  `local.custom_domain_active`, which needs `custom_domain_zone_id` (GHA secret
  `CUSTOM_DOMAIN_ZONE_ID`). That id is supplied from day one (a required bootstrap
  secret), so the Access app is created on the first deploy and wrangler attaches
  the custom domain in the same run — the app comes up behind Access immediately.
- Provider is cloudflare 5.x: Access policies are inline on the application
  resource, config blocks use `=` map syntax.
