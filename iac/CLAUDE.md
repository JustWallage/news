# iac/

Terraform owns ONE thing: the **production D1 database** (`main.tf`). Everything
else — the worker, its secrets, migrations, the **Workers custom domain**
(production `routes` in wrangler.jsonc), and all ephemeral e2e resources — is
owned by Wrangler/CI; never add those to Terraform.

There is **NO Cloudflare Access** and **no email allowlist**. The app is public:
authentication is handled entirely in the worker (Google OAuth + opaque session
cookies — see `worker/CLAUDE.md`), so anyone with a verified Google account can
sign in. Sign-in bot abuse is mitigated by Cloudflare Turnstile (a worker secret,
not an Access/Terraform resource). Do not reintroduce Access resources here
unless the auth model itself changes.

The custom domain is NOT a Terraform resource on purpose: Terraform runs before
the worker is deployed, so Wrangler creates it at deploy time (production
`routes`).

- State: R2 bucket `news-tfstate` (S3 backend; endpoint passed via
  `-backend-config` at init because backend blocks can't interpolate vars).
- Local validation only: `pnpm tf:init` (no backend) once, then `pnpm check`
  covers fmt+validate. Applies happen exclusively in the deploy pipeline.
- Provider is cloudflare 5.x: config blocks use `=` map syntax.
