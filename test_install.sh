#!/usr/bin/env bash
# Tests for install.sh — Run: bash test_install.sh

PASS=0; FAIL=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

FAKE_CLAUDE="${TMPDIR_ROOT}/claude/skills"
FAKE_CODEX="${TMPDIR_ROOT}/codex/skills"
FAKE_OPEN="${TMPDIR_ROOT}/opencode/skills"
mkdir -p "$FAKE_CLAUDE" "$FAKE_CODEX" "$FAKE_OPEN"

# Patched install.sh that writes to our fake dirs
PATCHED="${TMPDIR_ROOT}/install_test.sh"
sed -e "s|SKILL_DIR=\"\$(cd.*\"\$(dirname.*&&.*pwd)\"|SKILL_DIR=\"$SCRIPT_DIR\"|g" \
    -e "s|\"\${HOME}/.claude/skills\"|\"$FAKE_CLAUDE\"|g" \
    -e "s|\"\${HOME}/.codex/skills\"|\"$FAKE_CODEX\"|g" \
    -e "s|\"\${HOME}/.opencode/skills\"|\"$FAKE_OPEN\"|g" \
    "$SCRIPT_DIR/install.sh" > "$PATCHED"
chmod +x "$PATCHED"

ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

assert_link() {
  local desc="$1" dest="$2" tgt="$3"
  [ -L "$dest" ] && [ "$(readlink "$dest")" = "$tgt" ] && ok "$desc" || fail "$desc (expected link $dest → $tgt, got: $(ls -la "$dest" 2>/dev/null || echo missing))"
}

assert_absent() {
  [ ! -e "$1" ] && ok "$2" || fail "$2 ($1 should not exist)"
}

echo "Testing install.sh..."

# --status before install
out=$(bash "$PATCHED" --status 2>&1)
echo "$out" | grep -q "not installed" && ok "--status before install shows not-installed" || fail "--status output: $out"

# default install (all tools)
bash "$PATCHED" > /dev/null 2>&1
assert_link "Claude Code linked"  "$FAKE_CLAUDE/datum" "$SCRIPT_DIR"
assert_link "Codex linked"        "$FAKE_CODEX/datum"  "$SCRIPT_DIR"
assert_link "opencode linked"     "$FAKE_OPEN/datum"   "$SCRIPT_DIR"

# idempotent re-run
out=$(bash "$PATCHED" 2>&1)
echo "$out" | grep -q "Already installed" && ok "re-install is idempotent" || fail "re-install output: $out"

# --status shows linked
out=$(bash "$PATCHED" --status 2>&1)
echo "$out" | grep -q "→" && ok "--status shows linked" || fail "--status after install: $out"

# --uninstall removes all
bash "$PATCHED" --uninstall > /dev/null 2>&1
assert_absent "$FAKE_CLAUDE/datum" "Claude Code symlink removed"
assert_absent "$FAKE_CODEX/datum"  "Codex symlink removed"
assert_absent "$FAKE_OPEN/datum"   "opencode symlink removed"

# --claude only installs Claude Code
bash "$PATCHED" --claude > /dev/null 2>&1
assert_link   "--claude: Claude Code linked"  "$FAKE_CLAUDE/datum" "$SCRIPT_DIR"
assert_absent "$FAKE_CODEX/datum"  "--claude: Codex NOT linked"
assert_absent "$FAKE_OPEN/datum"   "--claude: opencode NOT linked"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
