# iac/

Terraform owns: prod D1, the Access application + Google IdP (the ONLY place the
allowed-email lives), and the Workers custom domain. Wrangler/CI own: the worker
itself, its secrets, migrations, and all ephemeral e2e resources — never add
those to Terraform.

- State: R2 bucket `news-tfstate` (S3 backend; endpoint passed via
  `-backend-config` at init because backend blocks can't interpolate vars).
- Local validation only: `pnpm tf:init` (no backend) once, then `pnpm check`
  covers fmt+validate. Applies happen exclusively in the deploy pipeline.
- `custom_domain` defaults to `news.justwallage.nl`; the domain + Access app are
  gated on `local.custom_domain_active`, which needs `custom_domain_zone_id`
  (GHA secret `CUSTOM_DOMAIN_ZONE_ID`). Unlike stelplaats, that id is supplied
  from day one, so the app comes up directly on the custom domain behind Access.
- Provider is cloudflare 5.x: Access policies are inline on the application
  resource, config blocks use `=` map syntax.
