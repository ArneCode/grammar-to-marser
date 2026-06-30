#!/usr/bin/env bash
# Create isolated git worktrees for parallel frontend redesign agents.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_BRANCH="${1:-design/baseline}"
DESIGNS=(welcome playground clarity)

if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  echo "error: branch $BASE_BRANCH does not exist." >&2
  echo "Run from repo root after the baseline commit:" >&2
  echo "  git branch design/baseline" >&2
  exit 1
fi

PARENT="$(dirname "$ROOT")"

for name in "${DESIGNS[@]}"; do
  branch="design/$name"
  path="$PARENT/pest-to-marser-design-$name"

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "branch $branch already exists"
  else
    git branch "$branch" "$BASE_BRANCH"
    echo "created branch $branch from $BASE_BRANCH"
  fi

  if [[ -d "$path" ]]; then
    echo "worktree exists: $path"
  else
    git worktree add "$path" "$branch"
    echo "worktree: $path -> $branch"
  fi
done

echo ""
echo "Worktrees ready. In Multitask mode, point each agent at its worktree:"
for name in "${DESIGNS[@]}"; do
  echo "  design/$name -> $PARENT/pest-to-marser-design-$name"
done
