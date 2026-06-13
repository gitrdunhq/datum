#!/usr/bin/env bash
# pre-tool-use-protect-tests.sh
# Block Write tool from deleting existing test functions.
# When a Write targets a test file that already exists, count the
# def test_ / class Test functions in the EXISTING file and verify
# they ALL appear in the new content. If any are missing, exit 2.
#
# This is the mechanical enforcement behind "APPEND only" — prompt
# instructions alone don't prevent agents from replacing the file.
#
# Hook event: PreToolUse (matcher: Write)
# Input: JSON on stdin with .tool_input.file_path and .tool_input.content

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
NEW_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# Only guard test files
case "$FILE_PATH" in
  *test_*|*_test.*|*Test*|*spec_*|*_spec.*)
    ;;
  *)
    exit 0
    ;;
esac

# If the file doesn't exist yet, allow (first write)
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Extract existing test function/class names
EXISTING_SIGS=$(grep -oE '(def test_[a-zA-Z0-9_]+|class Test[a-zA-Z0-9_]+)' "$FILE_PATH" 2>/dev/null || true)

if [ -z "$EXISTING_SIGS" ]; then
  exit 0
fi

MISSING=""
while IFS= read -r sig; do
  if ! echo "$NEW_CONTENT" | grep -qF "$sig"; then
    MISSING="${MISSING}  - ${sig}\n"
  fi
done <<< "$EXISTING_SIGS"

if [ -n "$MISSING" ]; then
  EXISTING_COUNT=$(echo "$EXISTING_SIGS" | wc -l | tr -d ' ')
  echo "BLOCKED: Write to $FILE_PATH would delete existing test functions." >&2
  echo "" >&2
  echo "Missing from new content ($EXISTING_COUNT existing):" >&2
  printf "$MISSING" >&2
  echo "" >&2
  echo "Use Edit to append new tests instead of Write to replace the file." >&2
  exit 2
fi

exit 0
