#!/usr/bin/env bash
# Create an isolated git worktree for a feature branch.
# Usage: scripts/worktree.sh <name> [open]
#   <name>  branch name; worktree lands at <repo>.worktrees/<name>
#   open    optional — also open the worktree in a VSCode window
set -euo pipefail

NAME="${1:-}"
OPEN="${2:-}"
if [[ -z "$NAME" ]]; then
  echo "Usage: $0 <name> [open]" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_PATH="$ROOT.worktrees/$NAME"
BRANCH="$NAME"

echo "Creating worktree '$WORKTREE_PATH' on branch '$BRANCH'..."
git worktree add "$WORKTREE_PATH" -b "$BRANCH"

if [[ "$OPEN" == "open" ]]; then
  echo "Opening VSCode..."
  nohup code "$WORKTREE_PATH" >/dev/null 2>&1 &
  disown
fi

echo "Copying env / secret files..."
ENV_FILES=(
  ".env"
  ".dev.vars"
  ".bootstrap.env"
)
for f in "${ENV_FILES[@]}"; do
  src="$ROOT/$f"
  dst="$WORKTREE_PATH/$f"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  copied $f"
  fi
done

# Playwright stored auth state, if present.
src="$ROOT/e2e/.auth"
if [[ -d "$src" ]]; then
  dst="$WORKTREE_PATH/e2e/.auth"
  mkdir -p "$(dirname "$dst")"
  cp -r "$src" "$dst"
  echo "  copied e2e/.auth"
fi

echo "Copying local state (.wrangler, dist)..."
for out in ".wrangler" "dist"; do
  src="$ROOT/$out"
  if [[ -d "$src" ]]; then
    dst="$WORKTREE_PATH/$out"
    rm -rf "$dst"
    cp -r "$src" "$dst"
    echo "  copied $out"
  fi
done

echo "Running pnpm install..."
pnpm install --dir "$WORKTREE_PATH"

echo "Running terraform init (backend disabled)..."
if [[ -d "$WORKTREE_PATH/iac" ]]; then
  terraform -chdir="$WORKTREE_PATH/iac" init -backend=false -input=false
fi

echo ""
echo "Worktree ready: $WORKTREE_PATH"
