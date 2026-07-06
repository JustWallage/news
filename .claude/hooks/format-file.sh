#!/bin/bash
# Prettier-format every file Claude edits, so check:format can never be the
# thing that fails the gate. Best-effort: never blocks the edit.
set -uo pipefail

file="$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).tool_input?.file_path??'')}catch{}})")"
[ -n "$file" ] && [ -f "$file" ] || exit 0

cd "$CLAUDE_PROJECT_DIR"
pnpm exec prettier --write --ignore-unknown --log-level=silent "$file" >/dev/null 2>&1 || true
