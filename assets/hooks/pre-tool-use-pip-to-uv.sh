#!/usr/bin/env bash
# pre-tool-use-pip-to-uv.sh
# Rewrites pip/pip3 commands to uv equivalents.
# Installed as a PreToolUse hook for the Bash tool.
#
# Input: the command string via STDIN or $1
# Output: rewritten command to STDOUT
# Exit 0 = proceed (with rewritten command if any)

if [ "${DATUM_SUBPROCESS:-0}" = "1" ]; then
  exit 0
fi

COMMAND="$1"

# pip install → uv pip install
if echo "$COMMAND" | grep -qE "^pip3? install "; then
  REWRITTEN=$(echo "$COMMAND" | sed -E 's/^pip3? install /uv pip install /')
  echo "REWRITE: $REWRITTEN"
  echo "REASON: datum enforces uv for all Python package management"
  exit 0
fi

# pip uninstall → uv pip uninstall
if echo "$COMMAND" | grep -qE "^pip3? uninstall "; then
  REWRITTEN=$(echo "$COMMAND" | sed -E 's/^pip3? uninstall /uv pip uninstall /')
  echo "REWRITE: $REWRITTEN"
  echo "REASON: datum enforces uv for all Python package management"
  exit 0
fi

# pip freeze → uv pip freeze
if echo "$COMMAND" | grep -qE "^pip3? freeze"; then
  REWRITTEN=$(echo "$COMMAND" | sed -E 's/^pip3? freeze/uv pip freeze/')
  echo "REWRITE: $REWRITTEN"
  echo "REASON: datum enforces uv for all Python package management"
  exit 0
fi

# pip list → uv pip list
if echo "$COMMAND" | grep -qE "^pip3? list"; then
  REWRITTEN=$(echo "$COMMAND" | sed -E 's/^pip3? list/uv pip list/')
  echo "REWRITE: $REWRITTEN"
  echo "REASON: datum enforces uv for all Python package management"
  exit 0
fi

# python -m pip → uv pip
if echo "$COMMAND" | grep -qE "python3? -m pip "; then
  REWRITTEN=$(echo "$COMMAND" | sed -E 's/python3? -m pip /uv pip /')
  echo "REWRITE: $REWRITTEN"
  echo "REASON: datum enforces uv for all Python package management"
  exit 0
fi

exit 0
