#!/usr/bin/env bash
# pre-commit-lane-tools-manifest.sh
# Rejects commits that add files to scripts/lane-tools/ without a manifest entry.
# Installed by: python3 scripts/bootstrap/install_hooks.py

set -euo pipefail
trap 'echo "WARNING: hook crashed at line $LINENO. Failing open." >&2; exit 0' ERR

MANIFEST="scripts/lane-tools/manifest.toml"
LANE_TOOLS_DIR="scripts/lane-tools/"

# Find staged files in lane-tools/ (excluding README.md and manifest.toml)
STAGED=$(git diff --cached --name-only | grep "^${LANE_TOOLS_DIR}" | grep -v "README.md" | grep -v "manifest.toml" || true)

if [ -z "$STAGED" ]; then
  exit 0
fi

if [ ! -f "$MANIFEST" ]; then
  echo "❌ lane-tools-manifest: $MANIFEST not found. Cannot validate new tools."
  exit 2
fi

MISSING=()
while IFS= read -r file; do
  tool_name=$(basename "$file" | sed 's/\.[^.]*$//')
  if ! grep -q "\[tools\.${tool_name}\]" "$MANIFEST"; then
    MISSING+=("$file")
  fi
done <<< "$STAGED"

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌ lane-tools-manifest: commit blocked."
  echo "   The following tools are missing manifest entries in $MANIFEST:"
  for f in "${MISSING[@]}"; do
    echo "   - $f"
  done
  echo ""
  echo "   Add a [tools.<name>] entry with description, permissions, and timeout_seconds."
  exit 2
fi

exit 0
