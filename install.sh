#!/usr/bin/env bash
# install.sh — Register the datum skill for any supported AI coding tool.
#
# Usage:
#   bash install.sh              # auto-detect installed tools, install for all
#   bash install.sh --claude     # Claude Code only
#   bash install.sh --codex      # Codex only
#   bash install.sh --opencode   # opencode only
#   bash install.sh --kiro       # Kiro only
#   bash install.sh --gemini     # Gemini CLI only
#   bash install.sh --list       # show which tools are detected on this machine
#   bash install.sh --status     # show current install state for all tools
#   bash install.sh --uninstall  # remove all symlinks (or pass --<tool> to scope it)
#
# Adding a new tool: append one line to TOOL_REGISTRY below. Nothing else changes.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_NAME="datum"

# ── Tool Registry ──────────────────────────────────────────────────────────────
# One entry per supported tool.
# Format: "flag|display_name|skills_dir|detect_binary"
#
# detect_binary: name of the CLI binary for this tool (used for auto-detection).
# If the binary is on PATH OR the skills_dir already exists, the tool is considered present.
#
# To add a new tool: append one line. Nothing else in this file needs to change.
TOOL_REGISTRY=(
  "claude|Claude Code|${HOME}/.claude/skills|claude"
  "codex|Codex|${HOME}/.codex/skills|codex"
  "opencode|opencode|${HOME}/.opencode/skills|opencode"
  "kiro|Kiro|${HOME}/.kiro/skills|kiro"
  "gemini|Gemini CLI|${HOME}/.gemini/skills|gemini"
)

# ── Registry helpers ──────────────────────────────────────────────────────────

# Parse a registry entry by field index (0=flag, 1=name, 2=dir, 3=bin)
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

# ── Core operations ───────────────────────────────────────────────────────────

link_skill() {
  local dir="$1" name="$2"
  mkdir -p "$dir"
  local dest="${dir}/${SKILL_NAME}"
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$SKILL_DIR" ]; then
    skipped+=("${name}: already linked → ${dest}")
    return
  fi
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    errors+=("${name}: ${dest} exists and is not a symlink — remove it manually first")
    return
  fi
  ln -sfn "$SKILL_DIR" "$dest"
  installed+=("${name}: ${dest} → ${SKILL_DIR}")
}

unlink_skill() {
  local dir="$1" name="$2"
  local dest="${dir}/${SKILL_NAME}"
  if [ -L "$dest" ]; then
    rm "$dest"
    echo "  ✓ Removed $dest (${name})"
  else
    echo "  — Not installed for ${name}"
  fi
}

status_skill() {
  local dir="$1" name="$2"
  local dest="${dir}/${SKILL_NAME}"
  if [ -L "$dest" ]; then
    echo "  ✓ ${name}: ${dest} → $(readlink "$dest")"
  elif [ -d "$dest" ]; then
    echo "  ! ${name}: ${dest} exists but is not a symlink"
  else
    echo "  — ${name}: not installed"
  fi
}

# ── Argument parsing ──────────────────────────────────────────────────────────

UNINSTALL=false
STATUS=false
LIST=false
explicit_entries=()

for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=true ;;
    --status)    STATUS=true ;;
    --list)      LIST=true ;;
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
  for e in "${TOOL_REGISTRY[@]}"; do
    status_skill "$(_field "$e" 2)" "$(_field "$e" 1)"
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

# ── Build target list ─────────────────────────────────────────────────────────

target_entries=()
if [ ${#explicit_entries[@]} -gt 0 ]; then
  target_entries=("${explicit_entries[@]}")
elif $UNINSTALL; then
  # --uninstall with no tool flag = uninstall everything
  target_entries=("${TOOL_REGISTRY[@]}")
else
  # Auto-detect: act on every tool that's present on this machine
  for e in "${TOOL_REGISTRY[@]}"; do
    is_detected "$e" && target_entries+=("$e")
  done
  if [ ${#target_entries[@]} -eq 0 ]; then
    echo "No supported AI coding tools detected on this machine."
    echo "Use --<tool> to force install. Known tools: $(all_flags | xargs printf ' --%s')"
    exit 1
  fi
fi

# ── Execute ───────────────────────────────────────────────────────────────────

installed=(); skipped=(); errors=()

if $UNINSTALL; then
  echo "Removing datum skill symlinks..."
  for e in "${target_entries[@]}"; do
    unlink_skill "$(_field "$e" 2)" "$(_field "$e" 1)"
  done
  echo "Done."
  exit 0
fi

for e in "${target_entries[@]}"; do
  link_skill "$(_field "$e" 2)" "$(_field "$e" 1)"
done

# ── Report ────────────────────────────────────────────────────────────────────

[ ${#installed[@]} -gt 0 ] && echo "✓ Installed:"   && printf '    %s\n' "${installed[@]}"
[ ${#skipped[@]}  -gt 0 ] && echo "— Already installed:" && printf '    %s\n' "${skipped[@]}"
[ ${#errors[@]}   -gt 0 ] && echo "✗ Errors:"       && printf '    %s\n' "${errors[@]}" && exit 1

echo ""
echo "Skill source: $SKILL_DIR"
echo "Active immediately — no reload needed."
