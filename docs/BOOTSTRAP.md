# Bootstrap — one-time setup

Everything scriptable is in `scripts/bootstrap.sh`. The steps below are the only
truly manual ones. Do them once, in order.

## 1. Cloudflare API token (dashboard)

Cloudflare dashboard → My Profile → API Tokens → Create Token (custom):

- Account / Workers Scripts / Edit
- Account / D1 / Edit
- Account / Workers R2 Storage / Edit
- Account / Access: Apps and Policies / Edit
- Account / Access: Organizations, Identity Providers, and Groups / Edit
- Account / Workers AI / Read

Copy the token → `CLOUDFLARE_API_TOKEN`.
Your account id (dashboard → Workers & Pages, right sidebar) → `CLOUDFLARE_ACCOUNT_ID`.
Your workers.dev subdomain (Workers & Pages → subdomain, or `wrangler whoami`) → `WORKERS_DEV_SUBDOMAIN`.

## 2. R2 S3 credentials for Terraform state (dashboard)

Dashboard → R2 → Manage R2 API Tokens → Create API Token (Object Read & Write,
scope: bucket `news-tfstate` — create the token after the bucket exists, or
scope account-wide). Copy:

- Access Key ID → `CLOUDFLARE_R2_ACCESS_KEY_ID`
- Secret Access Key → `CLOUDFLARE_R2_SECRET_ACCESS_KEY`

## 3. Google OAuth client — reuse the existing one

This project reuses the same Google OAuth client that stelplaats's Access setup
uses (the redirect URI is the shared Cloudflare Access team-domain callback,
`https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`, so nothing
new is needed in the Google console). Copy its id/secret →
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## 4. Zone id for justwallage.nl

Dashboard → `justwallage.nl` → Overview → right sidebar → Zone ID →
`CUSTOM_DOMAIN_ZONE_ID`. This activates `news.justwallage.nl` and its Access app
on the first deploy.

## 5. Run the bootstrap script

```sh
cp .bootstrap.env.example .bootstrap.env   # fill in values from steps 1–4 (+ TEST_AUTH_TOKEN)
pnpm exec wrangler login
gh auth login
./scripts/bootstrap.sh
```

This creates the R2 state bucket, pushes all GitHub Actions secrets
(client-side encrypted by `gh`), scaffolds `.dev.vars`, and applies local
migrations. Re-running is safe.

## 6. First pipeline run

Push to `main` (or push a branch with `run-pipeline` in the commit title for a
no-deploy dry run). The pipeline terraform-applies the Cloudflare resources
(prod D1, the Google IdP, the Access app on `news.justwallage.nl`, and the
Workers custom domain) and deploys.

Because `custom_domain_zone_id` is set from day one, the app comes up directly
on `https://news.justwallage.nl` behind Cloudflare Access (allowing only
`just@wallage.nl`) — there is no interim "enable Access on workers.dev" step.

## 7. First data

Local and e2e use fake Hacker News + Workers AI deps, so real curated stories
only appear in production. After the first deploy:

1. Sign in at `https://news.justwallage.nl` (Google, as just@wallage.nl).
2. Open **preferences**, write your interests, save.
3. Trigger the first run: `POST https://news.justwallage.nl/api/digest/run`
   (from the browser console while signed in:
   `await fetch("/api/digest/run", { method: "POST" }).then(r => r.json())`).

After that the cron refreshes the feed every morning at 06:20 Europe/Amsterdam.
