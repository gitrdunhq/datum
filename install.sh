#!/usr/bin/env bash
# install.sh — Install datum skill from GitHub and register for AI coding tools.
#
# Usage:
#   bash install.sh                  # install from GitHub, register all detected tools
#   bash install.sh --update         # pull latest from GitHub, keep registrations
#   bash install.sh --claude         # register Claude Code only (after install)
#   bash install.sh --codex          # register Codex only
#   bash install.sh --opencode       # register opencode only
#   bash install.sh --kiro           # register Kiro only
#   bash install.sh --gemini         # register Gemini CLI only
#   bash install.sh --list           # show which tools are detected
#   bash install.sh --status         # show current install state
#   bash install.sh --uninstall      # remove all registrations + installed copy
#   bash install.sh --dev            # register tools pointing at THIS repo (dev mode)
#
# Architecture:
#   1. Clone/pull gitrdunhq/datum from GitHub → ~/.agents/skills/datum (installed copy)
#   2. Symlink each tool's skill dir → ~/.agents/skills/datum (cross-tool sharing)
#   Local repo is for development only. install.sh ships a versioned copy.

set -euo pipefail

GITHUB_REPO="gitrdunhq/datum"
INSTALL_DIR="${HOME}/.agents/skills/datum"
SKILL_NAME="datum"
BIN_DIR="${HOME}/.local/bin"

# ── Tool Registry ──────────────────────────────────────────────────────────────
# Format: "flag|display_name|skills_dir|detect_binary"
TOOL_REGISTRY=(
  "claude|Claude Code|${HOME}/.claude/skills|claude"
  "codex|Codex|${HOME}/.codex/skills|codex"
  "opencode|opencode|${HOME}/.opencode/skills|opencode"
  "kiro|Kiro|${HOME}/.kiro/skills|kiro"
  "gemini|Gemini CLI|${HOME}/.gemini/skills|gemini"
)

# ── Registry helpers ──────────────────────────────────────────────────────────

_field() { local entry="$1" idx="$2"; echo "$entry" | cut -d'|' -f$((idx+1)); }

is_detected() {
  local entry="$1"
  local bin dir
  bin="$(_field "$entry" 3)"
  dir="$(_field "$entry" 2)"
  command -v "$bin" >/dev/null 2>&1 || [ -d "$dir" ]
}

entry_for_flag() {
  local want="$1"
  for e in "${TOOL_REGISTRY[@]}"; do
    [ "$(_field "$e" 0)" = "$want" ] && echo "$e" && return
  done
}

all_flags() { for e in "${TOOL_REGISTRY[@]}"; do _field "$e" 0; done; }

# ── Prerequisite checks ─────────────────────────────────────────────────────

check_prerequisites() {
  local failed=false

  if ! command -v git >/dev/null 2>&1; then
    echo "✗ git not found."
    echo "  Install: https://git-scm.com/downloads"
    failed=true
  fi

  if ! command -v uv >/dev/null 2>&1; then
    echo "✗ uv not found. datum requires uv for Python environment management."
    echo "  Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
    failed=true
  fi

  local python_cmd=""
  if command -v python3 >/dev/null 2>&1; then
    python_cmd="python3"
  elif command -v python >/dev/null 2>&1; then
    python_cmd="python"
  fi

  if [ -z "$python_cmd" ]; then
    echo "✗ Python not found. datum requires Python >= 3.12."
    echo "  macOS:  brew install python@3.12"
    echo "  Ubuntu: sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt install python3.12"
    failed=true
  else
    local py_version
    py_version=$($python_cmd -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    local py_major py_minor
    py_major=$(echo "$py_version" | cut -d. -f1)
    py_minor=$(echo "$py_version" | cut -d. -f2)
    if [ "$py_major" -lt 3 ] || { [ "$py_major" -eq 3 ] && [ "$py_minor" -lt 12 ]; }; then
      echo "✗ Python $py_version found, but datum requires >= 3.12."
      echo "  macOS:  brew install python@3.12"
      echo "  Ubuntu: sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt install python3.12"
      failed=true
    else
      echo "✓ Python $py_version"
    fi
  fi

  if $failed; then
    echo ""
    echo "Fix the above and re-run: bash install.sh"
    exit 1
  fi

  echo "✓ git $(git --version | cut -d' ' -f3)"
  echo "✓ uv $(uv --version 2>/dev/null | head -1)"
  echo ""
}

# ── Post-install verification ────────────────────────────────────────────────

install_cli_wrapper() {
  local target_dir="$1"
  mkdir -p "$BIN_DIR"
  cat > "${BIN_DIR}/datum" <<WRAPPER
#!/usr/bin/env bash
export DATUM_PROJECT_DIR="\$(pwd)"
exec uv run --directory "${target_dir}" datum "\$@"
WRAPPER
  chmod +x "${BIN_DIR}/datum"

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
    echo ""
    echo "⚠ ${BIN_DIR} is not on your PATH. Add it:"
    echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc  # or ~/.zshrc"
  fi
  echo "✓ CLI wrapper installed: ${BIN_DIR}/datum"
}

verify_install() {
  local dir="$1"
  echo ""
  echo "Verifying install..."
  if uv run --directory "$dir" datum doctor 2>/dev/null | grep -q '"status": "pass"'; then
    echo "✓ datum doctor passed"
  else
    echo "⚠ datum doctor did not pass cleanly. This may be OK for first install."
    echo "  Debug with: datum doctor"
  fi
  echo ""
  echo "Try it:"
  echo "  datum status"
  echo "  datum classify"
  echo "  datum doctor"
}

# ── GitHub install ───────────────────────────────────────────────────────────

install_from_github() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Updating from GitHub..."
    git -C "$INSTALL_DIR" fetch origin main --quiet
    git -C "$INSTALL_DIR" reset --hard origin/main --quiet
    echo "✓ Updated to $(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
  else
    echo "Installing from GitHub..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    if [ -d "$INSTALL_DIR" ]; then
      echo "  Removing existing non-git install at $INSTALL_DIR"
      rm -rf "$INSTALL_DIR"
    fi
    git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "$INSTALL_DIR" --quiet
    echo "✓ Installed $(git -C "$INSTALL_DIR" rev-parse --short HEAD) → $INSTALL_DIR"
  fi

  # Install Python deps into the datum venv
  echo "Installing Python dependencies..."
  uv pip install --directory "$INSTALL_DIR" -e "$INSTALL_DIR" --quiet 2>/dev/null || true

  # On Apple Silicon, install MLX extras for local LLM
  if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
    echo "Apple Silicon detected — installing MLX extras..."
    uv pip install --directory "$INSTALL_DIR" -e "${INSTALL_DIR}[memory]" --quiet 2>/dev/null || \
      echo "  ⚠ MLX extras failed (non-fatal). Install manually: cd $INSTALL_DIR && uv pip install -e '.[memory]'"
  fi
}

# ── Tool registration ────────────────────────────────────────────────────────

register_tool() {
  local dir="$1" name="$2" target="$3"
  mkdir -p "$dir"
  local dest="${dir}/${SKILL_NAME}"
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$target" ]; then
    skipped+=("${name}: already linked → ${dest}")
    return
  fi
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    errors+=("${name}: ${dest} exists and is not a symlink — remove it manually first")
    return
  fi
  ln -sfn "$target" "$dest"
  registered+=("${name}: ${dest} → ${target}")
}

unregister_tool() {
  local dir="$1" name="$2"
  local dest="${dir}/${SKILL_NAME}"
  if [ -L "$dest" ]; then
    rm "$dest"
    echo "  ✓ Removed $dest (${name})"
  else
    echo "  — Not registered for ${name}"
  fi
}

status_tool() {
  local dir="$1" name="$2"
  local dest="${dir}/${SKILL_NAME}"
  if [ -L "$dest" ]; then
    local target
    target="$(readlink "$dest")"
    if [ "$target" = "$INSTALL_DIR" ]; then
      echo "  ✓ ${name}: ${dest} → installed copy"
    else
      echo "  ! ${name}: ${dest} → ${target} (not pointing at installed copy)"
    fi
  elif [ -d "$dest" ]; then
    echo "  ! ${name}: ${dest} exists but is not a symlink"
  else
    echo "  — ${name}: not registered"
  fi
}

# ── Argument parsing ──────────────────────────────────────────────────────────

UNINSTALL=false
STATUS=false
LIST=false
UPDATE=false
DEV_MODE=false
explicit_entries=()

for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=true ;;
    --status)    STATUS=true ;;
    --list)      LIST=true ;;
    --update)    UPDATE=true ;;
    --dev)       DEV_MODE=true ;;
    --*)
      flag="${arg#--}"
      entry="$(entry_for_flag "$flag")"
      if [ -z "$entry" ]; then
        echo "Unknown flag: $arg"
        echo "Known tools: $(all_flags | xargs printf ' --%s')"
        exit 1
      fi
      explicit_entries+=("$entry")
      ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Status / list ─────────────────────────────────────────────────────────────

if $STATUS; then
  echo "datum skill install status:"
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  Installed: $(git -C "$INSTALL_DIR" rev-parse --short HEAD) ($(git -C "$INSTALL_DIR" log -1 --format='%ci' | cut -d' ' -f1))"
    echo "  Source: $INSTALL_DIR"
  elif [ -d "$INSTALL_DIR" ]; then
    echo "  Installed: $INSTALL_DIR (not a git clone)"
  else
    echo "  Not installed"
  fi
  echo ""
  echo "Tool registrations:"
  for e in "${TOOL_REGISTRY[@]}"; do
    status_tool "$(_field "$e" 2)" "$(_field "$e" 1)"
  done
  exit 0
fi

if $LIST; then
  echo "Detected tools (binary on PATH or skills dir exists):"
  for e in "${TOOL_REGISTRY[@]}"; do
    name="$(_field "$e" 1)"
    flag="$(_field "$e" 0)"
    if is_detected "$e"; then
      echo "  ✓ ${name}  (--${flag})"
    else
      echo "  — ${name}  (not found)"
    fi
  done
  exit 0
fi

# ── Uninstall ─────────────────────────────────────────────────────────────────

if $UNINSTALL; then
  echo "Removing datum skill..."
  for e in "${TOOL_REGISTRY[@]}"; do
    unregister_tool "$(_field "$e" 2)" "$(_field "$e" 1)"
  done
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "  ✓ Removed installed copy at $INSTALL_DIR"
  fi
  echo "Done."
  exit 0
fi

# ── Prerequisite gate ─────────────────────────────────────────────────────────

if ! $DEV_MODE; then
  check_prerequisites
fi

# ── Build target list ─────────────────────────────────────────────────────────

target_entries=()
if [ ${#explicit_entries[@]} -gt 0 ]; then
  target_entries=("${explicit_entries[@]}")
else
  for e in "${TOOL_REGISTRY[@]}"; do
    is_detected "$e" && target_entries+=("$e")
  done
  if [ ${#target_entries[@]} -eq 0 ]; then
    echo "No supported AI coding tools detected on this machine."
    echo "Use --<tool> to force register. Known tools: $(all_flags | xargs printf ' --%s')"
    exit 1
  fi
fi

# ── Execute ───────────────────────────────────────────────────────────────────

# Determine the target directory for symlinks
if $DEV_MODE; then
  LINK_TARGET="$(cd "$(dirname "$0")" && pwd)"
  echo "DEV MODE: tools will point at local repo: $LINK_TARGET"
elif $UPDATE; then
  install_from_github
  LINK_TARGET="$INSTALL_DIR"
else
  install_from_github
  LINK_TARGET="$INSTALL_DIR"
fi

registered=(); skipped=(); errors=()

for e in "${target_entries[@]}"; do
  register_tool "$(_field "$e" 2)" "$(_field "$e" 1)" "$LINK_TARGET"
done

# ── Report ────────────────────────────────────────────────────────────────────

[ ${#registered[@]} -gt 0 ] && echo "✓ Registered:"        && printf '    %s\n' "${registered[@]}"
[ ${#skipped[@]}    -gt 0 ] && echo "— Already registered:" && printf '    %s\n' "${skipped[@]}"
[ ${#errors[@]}     -gt 0 ] && echo "✗ Errors:"             && printf '    %s\n' "${errors[@]}" && exit 1

echo ""
if $DEV_MODE; then
  install_cli_wrapper "$(cd "$(dirname "$0")" && pwd)"
  echo "Source: $(cd "$(dirname "$0")" && pwd) (local dev repo)"
else
  install_cli_wrapper "$LINK_TARGET"
  echo "Installed: $INSTALL_DIR"
  verify_install "$LINK_TARGET"
fi
echo ""
echo "Active immediately — no reload needed."
