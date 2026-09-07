"""Preflight: demand a robust .gitignore in the consumer repo.

Every scratch path datum writes must be ignored, or generated files end up in
``git add .``, collide with lane squash-merges ("untracked working tree files
would be overwritten by merge") and get blamed on agents (seen dogfooding in
eedom, #388 / merge precondition). The check asks git itself
(``git check-ignore``) so nested .gitignore files and negations are honoured —
a blanket ``.datum/*`` satisfies the ``.datum/...`` entries, ``!.datum/runs/``
does not.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

# Directory patterns (trailing slash) datum writes into a consumer repo.
REQUIRED_IGNORES: tuple[str, ...] = (
    ".datum/worktrees/",  # per-lane git worktrees (worktree_manager.WORKTREE_ROOT)
    ".datum/runs/",  # per-run state: lane markers, preflight skeletons, closeout data
    ".datum/skills/",  # repo-local copy of skills/*.js written by `datum init` (#353)
    ".datum/hooks/",  # materialised PostToolUse hook scripts (agents_materialize)
    ".temp/",  # scratch (never /tmp)
)

_BLOCK_HEADER = "# datum scratch paths (added by `datum gitignore-check --fix`)"


def _is_ignored(repo_root: Path, pattern: str) -> bool:
    # Probe a file inside the directory: works whether or not the dir exists
    # and exercises the same matching git uses at `git add` time.
    probe = pattern.rstrip("/") + "/__datum_probe__"
    # Only the REPO's own rules count: a machine-global excludes file (this
    # developer's ~/.config/git/ignore) would make the probe pass here while
    # every teammate and CI runner still commits the scratch paths.
    result = subprocess.run(
        [
            "git",
            "-c",
            "core.excludesFile=/dev/null",
            "check-ignore",
            "-q",
            "--no-index",
            probe,
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=10,
    )
    # 0 = ignored, 1 = not ignored, 128 = error (not a repo) → treat as missing.
    return result.returncode == 0


def check_gitignore(repo_root: Path) -> dict:
    """Return {"ok": bool, "missing": [pattern, ...]} for *repo_root*."""
    missing = [p for p in REQUIRED_IGNORES if not _is_ignored(repo_root, p)]
    return {"ok": not missing, "missing": missing}


def fix_gitignore(repo_root: Path) -> list[str]:
    """Append the missing patterns to <repo_root>/.gitignore. Returns what was added.

    Idempotent: a second call adds nothing. Existing content is preserved.
    """
    missing = check_gitignore(repo_root)["missing"]
    if not missing:
        return []
    path = repo_root / ".gitignore"
    existing = path.read_text() if path.exists() else ""
    parts: list[str] = []
    if existing and not existing.endswith("\n"):
        parts.append("\n")
    if existing:
        parts.append("\n")
    parts.append(_BLOCK_HEADER + "\n")
    parts.extend(f"{p}\n" for p in missing)
    path.write_text(existing + "".join(parts))
    return list(missing)
