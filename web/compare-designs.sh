#!/usr/bin/env bash
# Print commands to build and preview each design variant.
set -euo pipefail

WEB="$(cd "$(dirname "$0")" && pwd)"
PARENT="$(dirname "$(dirname "$WEB")")"
DESIGNS=(welcome playground clarity)
PORTS=(3001 3002 3003)

echo "Design comparison — build each worktree, then open in browser:"
echo ""

for i in "${!DESIGNS[@]}"; do
  name="${DESIGNS[$i]}"
  port="${PORTS[$i]}"
  wt="$PARENT/pest-to-marser-design-$name"
  branch="design/$name"

  echo "=== design/$name (port $port) ==="
  if [[ -d "$wt" ]]; then
    echo "  cd $wt/web && ./dev.sh && npx --yes serve -l $port ."
  else
    echo "  git checkout $branch && cd web && ./dev.sh && npx --yes serve -l $port ."
  fi
  echo "  open http://localhost:$port"
  echo ""
done

echo "Diff stats vs baseline:"
if git rev-parse --verify design/baseline >/dev/null 2>&1; then
  for name in "${DESIGNS[@]}"; do
    branch="design/$name"
    if git rev-parse --verify "$branch" >/dev/null 2>&1; then
      echo ""
      echo "--- $branch ---"
      git diff --stat design/baseline..."$branch" -- web/ 2>/dev/null || echo "(no commits yet on $branch)"
    fi
  done
else
  echo "  (create design/baseline first)"
fi
