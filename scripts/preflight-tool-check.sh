#!/usr/bin/env bash
# preflight-tool-check.sh — verify the globally installed `datum` uv-tool
# editable install still resolves to this repo, before datum-go runs anything
# else (#327).
#
# This script only ships inside the datum repo, so its mere presence at
# "$(git rev-parse --show-toplevel)/scripts/preflight-tool-check.sh" IS the
# self-hosted signal: the call site in skills/src/datum-go.ts only invokes it
# when that path exists, and skips the whole check otherwise. datum-go is
# also legitimately used as an external orchestrator against a different
# target repo (#378), where this invariant doesn't apply and the script
# won't be found.
#
# Pulled out of skills/src/datum-go.ts's inline preflight prompt so the LLM
# agent running it only has to execute one short, simple command instead of a
# long, heavily quote-escaped one-liner (#378 follow-up: the inline one-liner
# was error-prone for the agent to reproduce faithfully).
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)

DIRECT_URL=$(find "$HOME/.local/share/uv/tools/datum" -name direct_url.json 2>/dev/null | head -1)
if [ -z "$DIRECT_URL" ]; then
  echo '{"ok":true,"note":"no uv tool editable install found, skipping check"}'
  exit 0
fi

INSTALLED=$(python3 -c "import json,os,sys; d=json.load(open(sys.argv[1])); print(os.path.realpath(d.get('url','').replace('file://','')))" "$DIRECT_URL")
EXPECTED=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$REPO_ROOT")

if [ "$INSTALLED" != "$EXPECTED" ]; then
  python3 -c "import json,sys; print(json.dumps({'ok': False, 'installed': sys.argv[1], 'expected': sys.argv[2]}))" "$INSTALLED" "$EXPECTED"
else
  echo '{"ok":true}'
fi
