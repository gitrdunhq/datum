#!/usr/bin/env bash
# Tests for pre-tool-use-install-interceptor.sh
# Run: bash assets/hooks/test_pre-tool-use-install-interceptor.sh

PASS=0
FAIL=0
SCRIPT="assets/hooks/pre-tool-use-install-interceptor.sh"

assert_exit() {
  local desc="$1"
  local expected="$2"
  local cmd="$3"
  local actual
  # Capture exit without triggering set -e
  actual=$(bash "$SCRIPT" "$cmd" > /dev/null 2>&1; echo $?)
  if [ "$actual" -eq "$expected" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected exit $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "Testing $SCRIPT..."

assert_exit "blocks: pip install"          2 "pip install requests"
assert_exit "blocks: pip3 install"         2 "pip3 install numpy"
assert_exit "blocks: npm install"          2 "npm install lodash"
assert_exit "blocks: npm i"                2 "npm i react"
assert_exit "blocks: pnpm add"             2 "pnpm add typescript"
assert_exit "blocks: yarn add"             2 "yarn add axios"
assert_exit "blocks: brew install"         2 "brew install jq"
assert_exit "blocks: cargo add"            2 "cargo add serde"
assert_exit "blocks: go get"               2 "go get golang.org/x/tools"
assert_exit "blocks: gem install"          2 "gem install rails"
assert_exit "blocks: poetry add"           2 "poetry add httpx"
assert_exit "blocks: gh extension install" 2 "gh extension install github/gh-copilot"

assert_exit "allows: git status"           0 "git status"
assert_exit "allows: swift build"          0 "swift build"
assert_exit "allows: npm run test"         0 "npm run test"
assert_exit "allows: pip show"             0 "pip show requests"
assert_exit "allows: brew list"            0 "brew list"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
