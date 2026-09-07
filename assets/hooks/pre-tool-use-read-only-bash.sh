#!/usr/bin/env bash
# pre-tool-use-read-only-bash.sh
# Block a read-only agent (datum-reviewer, datum-skeptic) from running a Bash
# command that mutates the checkout or the filesystem. Test runs, git
# hash-object and every inspection command stay allowed.
#
# #375: a Review lens ran `git checkout <other branch>` in the operator's main
# checkout. The diff, the synthesis and the committed REVIEW-REPORT.md were all
# for the wrong branch, and the operator was left on another branch with a
# stray commit. An Edit|Write matcher cannot see that — it arrives as Bash.
#
# Inspection stays allowed on purpose: the lens prompts run `git diff`,
# `git log`, `git show`, `git rev-parse`, `git merge-base`, difft, ast-grep and
# ripgrep, and the diff command itself ends in `2>/dev/null`, so shell
# redirection is not treated as mutation.
#
# Hook event: PreToolUse (matcher: Bash)
# Input: JSON on stdin with .tool_input.command

set -euo pipefail

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# git subcommands that move HEAD, write objects/refs, or touch the index
GIT_MUTATORS='checkout|switch|reset|commit|merge|rebase|pull|push|cherry-pick|revert|stash|restore|clean|apply|am|worktree|tag|update-ref|update-index|gc|prune|filter-branch|init|clone|add|rm|mv|config|remote|fetch|submodule|notes|reflog[[:space:]]+delete'
GIT_RE="(^|[;&|(]|[[:space:]])git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+)*[[:space:]]+($GIT_MUTATORS)([[:space:]]|$)"
# `git branch` lists branches (read-only) unless it is asked to delete/rename
GIT_BRANCH_RE="(^|[;&|(]|[[:space:]])git[[:space:]]+branch[[:space:]]+(-[dDmMfc]|--delete|--move|--copy|--force)"
# non-git filesystem mutators
FS_RE='(^|[;&|(]|[[:space:]])(rm|rmdir|mv|cp|mkdir|touch|truncate|dd|chmod|chown|ln|tee|patch|install)([[:space:]]|$)'
# in-place editors and package installers
EDIT_RE='(sed[[:space:]]+(-[[:alnum:]]*i|--in-place)|perl[[:space:]]+-[[:alnum:]]*i|(npm|pnpm|yarn|pip|pip3|uv|brew|cargo|go)[[:space:]]+(install|add|get|remove|uninstall))'

for pattern in "$GIT_RE" "$GIT_BRANCH_RE" "$FS_RE" "$EDIT_RE"; do
  if printf '%s' "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: this agent is read-only; it may not run a command that mutates the checkout." >&2
    echo "Command: $COMMAND" >&2
    echo "Inspection is allowed (git diff/log/show/rev-parse/merge-base, difft, ast-grep, rg, cat)." >&2
    echo "Never change branches: the review is scoped to the branch it was launched on (#375)." >&2
    exit 2
  fi
done

exit 0
