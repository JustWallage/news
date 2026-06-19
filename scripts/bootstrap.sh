#!/usr/bin/env bash
# One-time project bootstrap. Idempotent — safe to re-run.
# Prerequisites (see docs/BOOTSTRAP.md): wrangler login, gh auth login,
# and a filled-in .bootstrap.env.
set -euo pipefail

cd "$(dirname "$0")/.."

REQUIRED_KEYS=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_R2_ACCESS_KEY_ID
  CLOUDFLARE_R2_SECRET_ACCESS_KEY
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  TEST_AUTH_TOKEN
  WORKERS_DEV_SUBDOMAIN
  CUSTOM_DOMAIN_ZONE_ID
)

# Pushed only when present — the Telegram bot is optional. deploy.yml puts these
# onto the production worker as secrets.
OPTIONAL_KEYS=(
  TELEGRAM_BOT_TOKEN
  TELEGRAM_WEBHOOK_SECRET
)

say() { printf '\033[1;32m[bootstrap]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Preconditions -----------------------------------------------------------
[ -f .bootstrap.env ] || die "Missing .bootstrap.env — copy .bootstrap.env.example and fill it in."
# shellcheck disable=SC1091
set -a; source .bootstrap.env; set +a

for key in "${REQUIRED_KEYS[@]}"; do
  [ -n "${!key:-}" ] || die "Missing $key in .bootstrap.env"
done

command -v gh >/dev/null || die "gh CLI not installed"
pnpm exec wrangler whoami >/dev/null 2>&1 || die "wrangler is not logged in — run: pnpm exec wrangler login"
gh auth status >/dev/null 2>&1 || die "gh is not logged in — run: gh auth login"

# --- R2 bucket for Terraform state ------------------------------------------
if pnpm exec wrangler r2 bucket list 2>/dev/null | grep -q "news-tfstate"; then
  say "R2 bucket news-tfstate already exists — skipping"
else
  say "Creating R2 bucket news-tfstate"
  pnpm exec wrangler r2 bucket create news-tfstate
fi

# --- GitHub Actions secrets ---------------------------------------------------
say "Setting GitHub Actions secrets"
for key in "${REQUIRED_KEYS[@]}"; do
  # value from stdin; `--body -` would set the literal string "-"
  printf '%s' "${!key}" | gh secret set "$key"
  say "  secret $key set"
done
for key in "${OPTIONAL_KEYS[@]}"; do
  if [ -n "${!key:-}" ]; then
    printf '%s' "${!key}" | gh secret set "$key"
    say "  secret $key set"
  else
    say "  secret $key not set (optional) — skipping"
  fi
done

# --- Local dev ----------------------------------------------------------------
if [ ! -f .dev.vars ]; then
  say "Creating .dev.vars from example"
  cp .dev.vars.example .dev.vars
else
  say ".dev.vars already exists — skipping"
fi

say "Applying local D1 migrations"
pnpm migrate:local >/dev/null

say "Done. Remaining manual steps (if not done yet) are listed in docs/BOOTSTRAP.md."
