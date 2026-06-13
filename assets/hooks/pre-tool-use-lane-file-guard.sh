#!/usr/bin/env bash
# pre-tool-use-lane-file-guard.sh
# Block Edit/Write to files not in the active lane's allowed list.
# Reads .datum/lane-context.json (written by the workflow before each
# agent dispatch) to get allowed_write_files and forbidden_write_files.
#
# If no lane-context.json exists, the hook is a no-op (non-workflow usage).
#
# Hook event: PreToolUse (matcher: Edit|Write)
# Input: JSON on stdin with .tool_input.file_path

set -euo pipefail

CONTEXT_FILE=".datum/lane-context.json"

# No lane context → not in a workflow run, allow everything
if [ ! -f "$CONTEXT_FILE" ]; then
  exit 0
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Normalize to relative path
FILE_PATH=$(echo "$FILE_PATH" | sed "s|^$(pwd)/||")

# Check forbidden list first
FORBIDDEN=$(jq -r '.forbidden_write_files[]? // empty' "$CONTEXT_FILE" 2>/dev/null)
if [ -n "$FORBIDDEN" ]; then
  while IFS= read -r pattern; do
    if [ "$FILE_PATH" = "$pattern" ]; then
      STAGE=$(jq -r '.stage // "unknown"' "$CONTEXT_FILE")
      TASK_ID=$(jq -r '.task_id // "unknown"' "$CONTEXT_FILE")
      echo "BLOCKED: $FILE_PATH is forbidden for ${STAGE} stage of ${TASK_ID}." >&2
      echo "Forbidden files are not writable in this TDD stage." >&2
      exit 2
    fi
  done <<< "$FORBIDDEN"
fi

# Check allowed list (if non-empty, only allowed files are writable)
ALLOWED=$(jq -r '.allowed_write_files[]? // empty' "$CONTEXT_FILE" 2>/dev/null)
if [ -n "$ALLOWED" ]; then
  FOUND=0
  while IFS= read -r pattern; do
    if [ "$FILE_PATH" = "$pattern" ]; then
      FOUND=1
      break
    fi
  done <<< "$ALLOWED"

  if [ "$FOUND" -eq 0 ]; then
    STAGE=$(jq -r '.stage // "unknown"' "$CONTEXT_FILE")
    TASK_ID=$(jq -r '.task_id // "unknown"' "$CONTEXT_FILE")
    echo "BLOCKED: $FILE_PATH is not in the allowed file list for ${STAGE} stage of ${TASK_ID}." >&2
    echo "" >&2
    echo "Allowed files:" >&2
    echo "$ALLOWED" | sed 's/^/  - /' >&2
    exit 2
  fi
fi

exit 0
