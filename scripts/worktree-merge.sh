#!/usr/bin/env bash
# Open (or reuse) a PR for the current worktree branch, merge it, then tear the
# worktree down. Run from inside the worktree.
# Usage: scripts/worktree-merge.sh <commit-message>
set -euo pipefail

MSG="${1:-}"
if [[ -z "$MSG" ]]; then
  echo "Usage: $0 <commit-message>" >&2
  exit 1
fi

WORKTREE_PATH="$(git rev-parse --show-toplevel)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
MAIN_REPO="$(git rev-parse --git-common-dir)"
MAIN_REPO="$(cd "$MAIN_REPO/.." && pwd)"

if gh pr view --json number --jq '.number' >/dev/null 2>&1; then
  echo "PR already exists, skipping creation."
else
  gh pr create --fill --title "$MSG"
fi

STATE=$(gh pr view --json state --jq '.state')
if [[ "$STATE" == "MERGED" ]]; then
  echo "PR already merged, skipping merge."
else
  echo "Checking mergeability..."
  MERGEABLE=""
  for i in {1..20}; do
    MERGEABLE=$(gh pr view --json mergeable --jq '.mergeable')
    if [[ "$MERGEABLE" != "UNKNOWN" ]]; then
      break
    fi
    echo "  mergeability pending, retrying ($i/20)..."
    sleep 1
  done

  case "$MERGEABLE" in
    MERGEABLE) ;;
    CONFLICTING)
      echo "Cannot merge: PR has conflicts — resolve them first." >&2
      exit 1
      ;;
    *)
      echo "Cannot merge: mergeability still '$MERGEABLE' after 20s." >&2
      exit 1
      ;;
  esac

  # No --delete-branch: deleting the local branch forces a checkout to main,
  # which fails when main is checked out in another worktree.
  gh pr merge --merge --subject "$MSG"
fi

# Close VSCode BEFORE removing the worktree — otherwise VSCode keeps watching the
# dir and recreates it (.DS_Store / workspace state) right after git deletes it,
# leaving an orphan folder behind.
echo "Closing VSCode window..."
osascript -e "tell application \"Code\" to close (windows whose name contains \"$BRANCH\")" 2>/dev/null || true
sleep 1

echo "Removing worktree..."
cd "$MAIN_REPO"
git worktree remove --force "$WORKTREE_PATH"
# Belt-and-suspenders: if anything recreated the dir, nuke it and prune git's metadata.
rm -rf "$WORKTREE_PATH"
git worktree prune

echo "Deleting branch..."
git branch -D "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true

echo "Done."
