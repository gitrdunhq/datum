#!/usr/bin/env bash
# Block agents from invoking local LLM via shell command.
# Local inference must go through Python API (run_phase/chat/structured).

COMMAND="$1"

if echo "$COMMAND" | grep -qE "datum local-llm|datum local_llm|mlx_lm|mlx-lm"; then
  echo "BLOCKED: Local LLM inference must not be invoked via shell."
  echo ""
  echo "Use the Python API instead:"
  echo "  from datum.local_llm import run_phase"
  echo "  result = run_phase(phase, prompt, schema)"
  echo ""
  echo "The CLI command 'datum local-llm' is for human testing only."
  exit 2
fi

exit 0
