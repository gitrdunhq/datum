#!/usr/bin/env bash
# PreToolUse hook: enforce file ownership from .datum/lane-context.json
# Blocks Write/Edit calls on files listed in forbidden_write_files.
# Exit 0 = allow, exit 2 = block (message on stdout as JSON).

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)

if [[ "$TOOL" != "Write" && "$TOOL" != "Edit" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path','') or d.get('path',''))" 2>/dev/null)

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

find_lane_context() {
  local dir="$1"
  while [[ "$dir" != "/" && "$dir" != "." ]]; do
    if [[ -f "$dir/.datum/lane-context.json" ]]; then
      echo "$dir/.datum/lane-context.json"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

CTX_FILE=$(find_lane_context "$(dirname "$FILE_PATH")") || exit 0

STAGE=$(python3 -c "import json; print(json.load(open('$CTX_FILE')).get('stage',''))" 2>/dev/null)
if [[ -z "$STAGE" ]]; then
  exit 0
fi

FORBIDDEN=$(python3 -c "
import json, os, sys
ctx = json.load(open('$CTX_FILE'))
forbidden = ctx.get('forbidden_write_files', [])
target = sys.argv[1]
wt = os.path.dirname(os.path.dirname('$CTX_FILE'))
rel = os.path.relpath(target, wt) if target.startswith(wt) else os.path.basename(target)
for f in forbidden:
    if rel == f or target.endswith(f):
        print(f)
        break
" "$FILE_PATH" 2>/dev/null)

# MODE: count (log only) | enforce (block writes)
MODE="count"

if [[ -n "$FORBIDDEN" ]]; then
  echo "[file-ownership] VIOLATION: ${STAGE} agent wrote to ${FORBIDDEN}" >> .datum/ownership-violations.log 2>/dev/null
  if [[ "$MODE" == "enforce" ]]; then
    echo "{\"result\": \"error\", \"message\": \"BLOCKED: ${STAGE} agent cannot write to ${FORBIDDEN} — file is in forbidden_write_files for this stage\"}"
    exit 2
  fi
fi

exit 0
