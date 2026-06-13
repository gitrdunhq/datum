#!/usr/bin/env bash
# post-tool-use-test-ratchet-live.sh
# After any Edit/Write to a test file, count the test functions and
# compare against the count BEFORE the workflow started (stored in
# .datum/lane-context.json as test_count_floor).
#
# If the count dropped, warn (but don't block — PostToolUse can't undo).
# The warning appears in the transcript so the agent self-corrects.
#
# Hook event: PostToolUse (matcher: Edit|Write)
# Input: JSON on stdin with .tool_input.file_path

set -euo pipefail

CONTEXT_FILE=".datum/lane-context.json"

if [ ! -f "$CONTEXT_FILE" ]; then
  exit 0
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only check test files
case "$FILE_PATH" in
  *test_*|*_test.*|*Test*|*spec_*|*_spec.*)
    ;;
  *)
    exit 0
    ;;
esac

if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

FLOOR=$(jq -r '.test_count_floor // 0' "$CONTEXT_FILE" 2>/dev/null)
CURRENT=$(grep -cE '(def test_|class Test)' "$FILE_PATH" 2>/dev/null || echo "0")

if [ "$CURRENT" -lt "$FLOOR" ]; then
  echo "WARNING: Test count dropped from $FLOOR to $CURRENT in $FILE_PATH." >&2
  echo "You may have deleted existing tests. This violates the TDD ratchet." >&2
  echo "Restore the missing tests before committing." >&2
fi

exit 0
