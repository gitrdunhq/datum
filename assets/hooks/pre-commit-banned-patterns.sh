#!/usr/bin/env bash
# Block high-risk staged diff patterns.

set -euo pipefail

diff="$(git diff --cached --unified=0 || true)"
[ -z "$diff" ] && exit 0

patterns_file=".datum/banned-patterns.txt"
if [ -f "$patterns_file" ]; then
  while IFS= read -r pattern; do
    [ -z "$pattern" ] && continue
    case "$pattern" in \#*) continue ;; esac
    if printf '%s\n' "$diff" | grep -E "$pattern" >/dev/null; then
      echo "DATUM banned-pattern hook blocked staged diff pattern: $pattern" >&2
      exit 2
    fi
  done < "$patterns_file"
else
  if printf '%s\n' "$diff" | grep -E '^\+.*(<<<<<<<|=======|>>>>>>>|DATUM_BANNED_PATTERN)' >/dev/null; then
    echo "DATUM banned-pattern hook blocked merge marker or explicit banned marker" >&2
    exit 2
  fi
fi

exit 0
