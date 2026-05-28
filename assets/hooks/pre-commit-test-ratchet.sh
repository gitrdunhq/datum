#!/usr/bin/env bash
# pre-commit-test-ratchet.sh — Enforces the test-strengthening invariant.
# Blocks commits that delete, weaken, or skip-rename tests.
# Installed by: python3 scripts/bootstrap/install_hooks.py

set -euo pipefail
trap 'echo "WARNING: hook crashed at line $LINENO. Failing open." >&2; exit 0' ERR

# Only run if test files are staged
STAGED_TEST_FILES=$(git diff --cached --name-only | grep -E '(Test|Spec|_test\.|_spec\.)' || true)
if [ -z "$STAGED_TEST_FILES" ]; then
  exit 0
fi

python3 scripts/test_ratchet.py --framework auto
STATUS=$?

if [ $STATUS -eq 2 ]; then
  echo ""
  echo "❌ Test ratchet: commit blocked. Run 'python3 scripts/test_ratchet.py' for details."
  exit 1
fi

exit 0
