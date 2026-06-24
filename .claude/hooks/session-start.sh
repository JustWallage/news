#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web (fresh, ephemeral container each session).
# Locally these are already installed, so skip to avoid slowing startup.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Run in the background so the session starts without waiting for downloads.
echo '{"async": true, "asyncTimeout": 600000}'

cd "$CLAUDE_PROJECT_DIR"

# Node deps + Playwright's Chromium binary for e2e (the `test:e2e:setup` backbone;
# NB no `--with-deps`, so it never touches apt). The Chromium download needs
# `cdn.playwright.dev` in the environment's network egress allowlist, else it 403s.
pnpm run test:e2e:setup

# Terraform: `pnpm check` runs `check:tf`, so the pre-commit gate needs it on
# PATH. Downloads from releases.hashicorp.com (must be egress-allowlisted).
if ! command -v terraform >/dev/null 2>&1; then
  TF_VERSION="1.9.8"
  TF_DIR="$HOME/.local/bin"
  mkdir -p "$TF_DIR"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/tf.zip" \
    "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_amd64.zip"
  unzip -o -q "$tmp/tf.zip" -d "$tmp"
  install -m 0755 "$tmp/terraform" "$TF_DIR/terraform"
  rm -rf "$tmp"
  echo "export PATH=\"$TF_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  export PATH="$TF_DIR:$PATH"
fi
