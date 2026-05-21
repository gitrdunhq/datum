#!/usr/bin/env bash
# Optional layer-boundary hook. Enforces .datum/layer-boundaries.txt when present.

set -euo pipefail
trap 'echo "WARNING: hook crashed at line $LINENO. Failing open." >&2; exit 0' ERR

rules=".datum/layer-boundaries.txt"
[ -f "$rules" ] || exit 0

staged_files="$(git diff --cached --name-only --diff-filter=ACM || true)"
[ -z "$staged_files" ] && exit 0

# Rule format: forbidden_regex
# Blank lines and # comments are ignored.
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  case "$pattern" in \#*) continue ;; esac
  if printf '%s\n' "$staged_files" | grep -E "$pattern" >/dev/null; then
    echo "DATUM layer-boundary hook blocked staged path matching: $pattern" >&2
    exit 2
  fi
done < "$rules"

exit 0
