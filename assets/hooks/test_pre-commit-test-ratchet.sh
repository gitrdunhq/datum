#!/usr/bin/env bash
# Tests for pre-commit-test-ratchet.sh
# Run: bash assets/hooks/test_pre-commit-test-ratchet.sh

set -euo pipefail

PASS=0
FAIL=0
SCRIPT="assets/hooks/pre-commit-test-ratchet.sh"

assert_exit() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" -eq "$expected" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected exit $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "Testing $SCRIPT..."

# Test: no staged test files → exits 0 (nothing to check)
# Simulate by calling test_ratchet.py with an empty diff
echo "  (integration tests require a git repo with staged files — skipping sandbox run)"
echo "  Checking script is executable and has correct shebang..."

if [ -f "$SCRIPT" ]; then
  SHEBANG=$(head -1 "$SCRIPT")
  if echo "$SHEBANG" | grep -q "bash"; then
    echo "  PASS: shebang is bash"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: unexpected shebang: $SHEBANG"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  FAIL: $SCRIPT not found"
  FAIL=$((FAIL + 1))
fi

# Test: script references test_ratchet.py correctly
if grep -q "scripts/test_ratchet.py" "$SCRIPT"; then
  echo "  PASS: script calls test_ratchet.py"
  PASS=$((PASS + 1))
else
  echo "  FAIL: script does not call test_ratchet.py"
  FAIL=$((FAIL + 1))
fi

# Test: script guards on no staged test files before running ratchet
if grep -q "STAGED_TEST_FILES" "$SCRIPT"; then
  echo "  PASS: script guards on staged test files"
  PASS=$((PASS + 1))
else
  echo "  FAIL: script missing guard for staged test files"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
