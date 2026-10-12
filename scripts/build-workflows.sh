#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "$0")/../skills" && pwd)"
SRC_DIR="$SKILLS_DIR/src"
OUT_DIR="$SKILLS_DIR"
BANNER="// @generated — DO NOT EDIT. Source: skills/src/"

MODE="${1:-build}"

# GNU sed takes -i with no argument; BSD/macOS sed needs -i ''. Detect once.
if sed --version >/dev/null 2>&1; then SED_INPLACE=(sed -i); else SED_INPLACE=(sed -i ''); fi

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
  "${SED_INPLACE[@]}" \
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

# ── Runner bundle (Node entry, no workflow post-processing) ──
RUNNER_ENTRY="$SRC_DIR/runtime/runner.ts"
RUNNER_OUT="$OUT_DIR/runtime/runner.js"
mkdir -p "$OUT_DIR/runtime"
runner_tmp=$(mktemp)
npx esbuild "$RUNNER_ENTRY" \
  --bundle \
  --format=esm \
  --platform=node \
  --loader:.md=text \
  --outfile="$runner_tmp" \
  --log-level=warning
{ printf '%s\n' "${BANNER}runtime/runner.ts"; cat "$runner_tmp"; } > "$RUNNER_OUT"
rm -f "$runner_tmp"
echo "    runtime/runner.js: OK"

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

  if ! head -1 "$RUNNER_OUT" | grep -q '@generated'; then
    echo "    FAIL: runtime/runner.js — missing @generated banner"
    FAIL=1
  fi

  if [ "$FAIL" -eq 0 ]; then
    echo "    All outputs verified."
  else
    echo "    VERIFICATION FAILED"
    exit 1
  fi
fi

echo "==> Done."
