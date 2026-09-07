"""The Claude Code auto-mode allow rules a datum consumer repo needs.

datum PRINTS these (``datum permissions-snippet``) and documents them in
SKILL.md; it never writes them into ``.claude/settings.local.json``. The
pipeline runs ``git reset --hard`` / ``git clean -fd`` in its own scratch
worktrees and a permission classifier rightly asks about that; granting the
allowance is the repo operator's decision, made in their own settings — a
tool that installs the rules permitting its own destructive operations is
granting itself permissions. Pushes and PR creation stay gated.
"""

from __future__ import annotations

import json

AUTO_MODE_ALLOW_RULES: tuple[str, str] = (
    "Running any step of the local 'datum' pipeline (Workflow scriptPath "
    "<skills_dir>/datum-go.js or its sub-workflows) — including act, merge, and "
    "closeout — is allowed without a per-run confirmation, as long as it only "
    "touches local git branches/worktrees and files under .datum/, docs/epics/, "
    "and the repo working tree, and does not itself run 'git push', "
    "'git push --force', or 'gh pr create'/'gh pr merge'.",
    "Running `git reset --hard`, `git clean -fd` (with or without --exclude), "
    "`git checkout`, `git status`, and `datum ...` commands when operating on a "
    "DATUM scratch lane worktree — any path containing `/.datum/worktrees/` under "
    "the repo root — whether invoked as `git -C <path> ...`, after `cd <path>`, or "
    "inside a multi-step batch script (these start with `__bo=$(mktemp)` and "
    "record each step's exit code as JSON). These worktrees are disposable "
    "per-lane checkouts created and torn down by the pipeline; resetting or "
    "cleaning them never touches the main checkout, uncommitted user work, or "
    "committed history. Do not treat these as destructive.",
)


def permissions_snippet() -> str:
    """The JSON block to merge into .claude/settings.local.json ("$defaults" first)."""
    return json.dumps({"autoMode": {"allow": ["$defaults", *AUTO_MODE_ALLOW_RULES]}}, indent=2)
