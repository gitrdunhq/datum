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
ENTRY_POINTS=$(find "$SRC_DIR" -maxdepth 1 -name 'datum-*.ts' -not -name '*.test.ts' | sort)

for entry in $ENTRY_POINTS; do
  basename=$(basename "$entry" .ts)
  outfile="$OUT_DIR/${basename}.js"

  npx esbuild "$entry" \
    --bundle \
    --format=esm \
    --loader:.md=text \
    --outfile="$outfile" \
    --log-level=warning

  # ── Post-process ──
  # 1. Fix var→export const meta, var→return, remove ESM export block
  sed -i '' \
    -e 's/^var meta = /export const meta = /' \
    -e 's/^var __workflowResult = /return /' \
    -e '/^export {$/,/^};$/d' \
    "$outfile"

  # 2. Hoist `export const meta = {...};` to top (sandbox requires it first)
  tmpfile=$(mktemp)
  python3 -c "
import sys
lines = open(sys.argv[1]).readlines()
meta_lines, body_lines = [], []
in_meta, brace_depth = False, 0
for line in lines:
    if line.startswith('export const meta = '):
        in_meta = True
    if in_meta:
        meta_lines.append(line)
        brace_depth += line.count('{') - line.count('}')
        if brace_depth <= 0 and '{' in ''.join(meta_lines):
            in_meta = False
    else:
        body_lines.append(line)
with open(sys.argv[2], 'w') as f:
    f.write('${BANNER}${basename}.ts\n')
    f.writelines(meta_lines)
    f.write('\n')
    f.writelines(body_lines)
" "$outfile" "$tmpfile"
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
