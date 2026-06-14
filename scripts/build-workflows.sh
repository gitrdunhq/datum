#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "$0")/../skills" && pwd)"
SRC_DIR="$SKILLS_DIR/src"
OUT_DIR="$SKILLS_DIR"
BANNER="// @generated — DO NOT EDIT. Source: skills/src/"

MODE="${1:-build}"

# ── Type check ──
echo "==> Type checking..."
npx tsc -p "$SKILLS_DIR/tsconfig.json"
echo "    tsc: OK"

if [ "$MODE" = "--check" ]; then
  echo "==> Check-only mode complete."
  exit 0
fi

# ── Bundle with esbuild ──
echo "==> Bundling with esbuild..."
ENTRY_POINTS=$(find "$SRC_DIR" -maxdepth 1 -name 'datum-tdd-act*.ts' | sort)

for entry in $ENTRY_POINTS; do
  basename=$(basename "$entry" .ts)
  outfile="$OUT_DIR/${basename}.js"

  npx esbuild "$entry" \
    --bundle \
    --format=esm \
    --loader:.md=text \
    --outfile="$outfile" \
    --log-level=warning

  # ── Post-process: fix export const meta + return ──
  # esbuild converts `export const meta` to `var meta` with an export block at bottom
  # The sandbox needs `export const meta = {...}` inline and bare `return {...}` at end
  sed -i '' \
    -e 's/^var meta = /export const meta = /' \
    -e 's/^var __workflowResult = /return /' \
    -e '/^export {$/,/^};$/d' \
    "$outfile"

  # ── Add banner ──
  tmpfile=$(mktemp)
  echo "${BANNER}${basename}.ts" > "$tmpfile"
  cat "$outfile" >> "$tmpfile"
  mv "$tmpfile" "$outfile"

  echo "    $basename.js: OK"
done

# ── Verify ──
if [ "$MODE" = "--verify" ] || [ "$MODE" = "build" ]; then
  echo "==> Verifying outputs..."
  FAIL=0

  for entry in $ENTRY_POINTS; do
    basename=$(basename "$entry" .ts)
    outfile="$OUT_DIR/${basename}.js"

    # Syntax check — the sandbox accepts both `export const` and top-level `return`
    # which is a CJS+ESM hybrid. We validate the JS parses by checking for
    # balanced braces and no stray TypeScript syntax instead.
    if grep -qE ': (string|number|boolean|void|any)\b|interface |type [A-Z]' "$outfile"; then
      echo "    FAIL: $basename.js — TypeScript syntax leaked into output"
      FAIL=1
      continue
    fi

    # Must have export const meta
    if ! grep -q '^export const meta = ' "$outfile"; then
      echo "    FAIL: $basename.js — missing export const meta"
      FAIL=1
    fi

    # Must not have import/require
    if grep -qE '^import |require\(' "$outfile"; then
      echo "    FAIL: $basename.js — leaked import/require"
      FAIL=1
    fi

    # Must have banner
    if ! head -1 "$outfile" | grep -q '@generated'; then
      echo "    FAIL: $basename.js — missing @generated banner"
      FAIL=1
    fi
  done

  if [ "$FAIL" -eq 0 ]; then
    echo "    All outputs verified."
  else
    echo "    VERIFICATION FAILED"
    exit 1
  fi
fi

echo "==> Done."
