#!/usr/bin/env bash
# Block commits that introduce oversized files.

set -euo pipefail
trap 'echo "WARNING: hook crashed at line $LINENO. Failing open." >&2; exit 0' ERR

MAX_BYTES="${DATUM_MAX_FILE_BYTES:-200000}"

staged_files="$(git diff --cached --name-only --diff-filter=ACM || true)"
[ -z "$staged_files" ] && exit 0

while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ -f "$file" ] || continue
  size="$(wc -c < "$file" | tr -d ' ')"
  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "DATUM file-size hook blocked $file ($size bytes > $MAX_BYTES bytes)" >&2
    exit 2
  fi
done <<EOF
$staged_files
EOF

exit 0
