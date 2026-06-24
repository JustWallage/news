# Bootstrap — one-time setup

Everything scriptable is in `scripts/bootstrap.sh`. The steps below are the only
truly manual ones. Do them once, in order.

## 1. Cloudflare API token (dashboard)

Cloudflare dashboard → My Profile → API Tokens → Create Token (custom):

- Account / Workers Scripts / Edit
- Account / D1 / Edit
- Account / Workers R2 Storage / Edit
- Account / Workers AI / Read
- Zone / Workers Routes / Edit (zone: justwallage.nl) — required so wrangler can
  attach the `news.justwallage.nl` custom domain at deploy time
- Zone / Zone / Read (zone: justwallage.nl) — to resolve the zone

(No Cloudflare Access scopes — auth is handled in the Worker, not by Access.)

Copy the token → `CLOUDFLARE_API_TOKEN`.
Your account id (dashboard → Workers & Pages, right sidebar) → `CLOUDFLARE_ACCOUNT_ID`.

## 2. R2 S3 credentials for Terraform state (dashboard)

Dashboard → R2 → Manage R2 API Tokens → Create API Token (Object Read & Write,
scope: bucket `news-tfstate` — create the token after the bucket exists, or
scope account-wide). Copy:

- Access Key ID → `CLOUDFLARE_R2_ACCESS_KEY_ID`
- Secret Access Key → `CLOUDFLARE_R2_SECRET_ACCESS_KEY`

## 3. Google OAuth client — create a dedicated one

The Worker runs the Google sign-in flow itself, so it needs its own OAuth client
(don't reuse a Cloudflare Access client — that couples lifecycles).

Google Cloud Console → APIs & Services → Credentials → Create credentials →
**OAuth client ID → Web application**:

- Authorized redirect URI: `https://news.justwallage.nl/auth/callback`
  (add `http://localhost:5173/auth/callback` too if you want real Google login in
  local dev — local otherwise uses the `DEV_USER_EMAIL` bypass).
- OAuth consent screen: **External** + Published, so any Google user can sign in.
  (The consent screen is per-project and can stay shared with your other apps.)

Copy the client id/secret → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. These are
GitHub Actions secrets; the deploy pipeline installs them onto the production
worker on every deploy (without them the app deploys but `/auth/*` returns 503).

## 4. Zone id for justwallage.nl

Dashboard → `justwallage.nl` → Overview → right sidebar → Zone ID →
`CUSTOM_DOMAIN_ZONE_ID`. Used so wrangler can attach `news.justwallage.nl` at
deploy time.

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
(prod D1) and the Workers custom domain, deploys, then installs the Google (and
Telegram) worker secrets. The app comes up on `https://news.justwallage.nl` with
self-serve Google sign-in — anyone with a verified Google account can sign in.

## 7. First data

e2e uses fake Hacker News + Workers AI deps; production (and local `pnpm dev`,
via your own `wrangler login`) hit the real services. To populate production
after the first deploy:

1. Sign in at `https://news.justwallage.nl` (Google).
2. Open **preferences**, write your interests, save.
3. Trigger the first run: `POST https://news.justwallage.nl/api/digest/run`
   (from the browser console while signed in:
   `await fetch("/api/digest/run", { method: "POST" }).then(r => r.json())`).

After that, link Telegram and set a daily slot to get an automatic morning push;
otherwise refresh the feed in the app on demand.

## 8. Telegram bot (optional)

The bot lets you set preferences and schedule up to three daily summaries from
Telegram. Its two credentials are **GitHub Actions secrets**; the deploy
pipeline installs them onto the production worker on every deploy (and skips the
bot when they are unset).

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`). Copy the
   HTTP API token and the bot's `@username`.
2. Put `TELEGRAM_BOT_USERNAME` (without the `@`) into `wrangler.jsonc` →
   `env.production.vars` so the app can build `t.me` deep links.
3. Set the two secrets (pick any random string for the webhook secret, e.g.
   `openssl rand -hex 32`). Either add them to `.bootstrap.env` and re-run
   `./scripts/bootstrap.sh`, or set them directly:

   ```sh
   gh secret set TELEGRAM_BOT_TOKEN
   gh secret set TELEGRAM_WEBHOOK_SECRET
   ```

   The next push to `main` deploys and installs them onto the worker.

4. Register the webhook with Telegram (uses the same secret so the worker can
   verify each call):

   ```sh
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d url="https://news.justwallage.nl/telegram/webhook" \
     -d secret_token="<TELEGRAM_WEBHOOK_SECRET>"
   ```

5. Deploy, then on the preferences page tap **Generate start command** and send
   the bot `/start <code>`. Configure summary times with `/daily_time HH:MM`.

The bot's slash-command list (the `/`-autocomplete the Telegram client shows) is
registered automatically on every deploy from `worker/lib/bot-commands.json` — no
manual `setMyCommands` step.

## 9. Cloudflare Turnstile (optional, recommended for a public app)

Turnstile is a bot-gate on the Google sign-in flow. Its two values are **GitHub
Actions secrets**; the deploy pipeline installs them onto the worker on every
deploy (and the gate stays off when they are unset — the sign-in screen shows the
plain button and the worker skips verification).

1. Cloudflare dashboard → Turnstile → Add widget. Hostname: `news.justwallage.nl`
   (add `localhost` only if you want to exercise it in `pnpm dev`). Copy the
   **site key** (public) and **secret key**.
2. Set both as repo secrets (add to `.bootstrap.env` and re-run
   `./scripts/bootstrap.sh`, or set directly):

   ```sh
   gh secret set TURNSTILE_SITE_KEY
   gh secret set TURNSTILE_SECRET_KEY
   ```

   The next push to `main` deploys and installs them. The widget then renders on
   the sign-in screen and `/auth/login` requires a valid token.
