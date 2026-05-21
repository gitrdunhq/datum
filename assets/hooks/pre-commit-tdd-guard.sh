#!/usr/bin/env bash
# During ACT, block source-only changes that have no staged test/properties evidence.

set -euo pipefail

phase="$(python3 - <<'PY'
import json
from pathlib import Path
p = Path(".datum/state.json")
if not p.exists():
    print("")
else:
    try:
        print(json.loads(p.read_text()).get("current_phase", ""))
    except Exception:
        print("")
PY
)"

[ "$phase" = "act" ] || exit 0

staged_files="$(git diff --cached --name-only --diff-filter=ACM || true)"
[ -z "$staged_files" ] && exit 0

source_count=0
evidence_count=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  case "$file" in
    *Test*|*test*|*Spec*|*spec*|*_test.*|*_spec.*|PROPERTIES.md|TASKS.md)
      evidence_count=$((evidence_count + 1))
      ;;
    *.swift|*.ts|*.tsx|*.js|*.jsx|*.go|*.py|*.rs|*.java|*.kt)
      source_count=$((source_count + 1))
      ;;
  esac
done <<EOF
$staged_files
EOF

if [ "$source_count" -gt 0 ] && [ "$evidence_count" -eq 0 ]; then
  echo "DATUM TDD guard blocked source-only ACT commit without staged test or property evidence" >&2
  exit 2
fi

exit 0
