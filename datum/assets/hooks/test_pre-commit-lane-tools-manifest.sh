#!/usr/bin/env bash
# Tests for pre-commit-lane-tools-manifest.sh
# Run: bash assets/hooks/test_pre-commit-lane-tools-manifest.sh

PASS=0
FAIL=0
SCRIPT="assets/hooks/pre-commit-lane-tools-manifest.sh"

echo "Testing $SCRIPT..."

# Structure check: script must exist
if [ -f "$SCRIPT" ]; then
  echo "  PASS: script exists"
  PASS=$((PASS + 1))
else
  echo "  FAIL: $SCRIPT not found"
  FAIL=$((FAIL + 1))
fi

# Must reference manifest.toml
if grep -q "manifest.toml" "$SCRIPT"; then
  echo "  PASS: references manifest.toml"
  PASS=$((PASS + 1))
else
  echo "  FAIL: does not reference manifest.toml"
  FAIL=$((FAIL + 1))
fi

# Must check for lane-tools/ directory
if grep -q "lane-tools" "$SCRIPT"; then
  echo "  PASS: checks lane-tools directory"
  PASS=$((PASS + 1))
else
  echo "  FAIL: does not check lane-tools"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
