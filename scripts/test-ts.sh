#!/usr/bin/env bash
# Unit-test runner for the TypeScript workflow-script helpers.
# Transpiles skills/src/shared/utils.ts to an importable ESM module, then runs node --test.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$REPO_ROOT/.temp/ts-test"

mkdir -p "$OUT_DIR"
npx esbuild "$REPO_ROOT/skills/src/shared/utils.ts" \
  --bundle \
  --format=esm \
  --outfile="$OUT_DIR/utils.mjs" \
  --log-level=warning

node --test "$REPO_ROOT"/tests/ts/*.test.mjs
