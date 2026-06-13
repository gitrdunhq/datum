#!/usr/bin/env bash
# pre-tool-use-commit-format.sh
# Enforce TDD commit message convention during workflow runs.
# Reads .datum/lane-context.json to get the expected commit_prefix.
# Blocks git commit if the message doesn't start with the prefix.
#
# Hook event: PreToolUse (matcher: Bash, if: Bash(git commit*))
# Input: JSON on stdin with .tool_input.command

set -euo pipefail

CONTEXT_FILE=".datum/lane-context.json"

# No lane context → not in a workflow run
if [ ! -f "$CONTEXT_FILE" ]; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only check git commit commands
if ! echo "$COMMAND" | grep -qE 'git commit'; then
  exit 0
fi

# Extract the commit message from -m flag
MSG=$(echo "$COMMAND" | grep -oP '(?<=-m\s)["\x27]([^"\x27]*)["\x27]' | head -1 | tr -d "\"'" || true)
if [ -z "$MSG" ]; then
  # Try -m "msg" with spaces
  MSG=$(echo "$COMMAND" | sed -n 's/.*-m[[:space:]]*"\([^"]*\)".*/\1/p' || true)
fi

if [ -z "$MSG" ]; then
  exit 0
fi

PREFIX=$(jq -r '.commit_prefix // empty' "$CONTEXT_FILE")
if [ -z "$PREFIX" ]; then
  exit 0
fi

if ! echo "$MSG" | grep -qF "$PREFIX"; then
  echo "BLOCKED: Commit message must start with '${PREFIX}'." >&2
  echo "Got: ${MSG}" >&2
  echo "" >&2
  echo "Format: ${PREFIX}: <description>" >&2
  exit 2
fi

exit 0
