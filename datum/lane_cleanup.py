"""Deterministic pre-RED lane-worktree cleanup.

Structured replacement for a free-text "list files matching a pattern, then
rm each one" agent prompt previously used by the datum-tdd-act-lane workflow.
That prompt read as an arbitrary shell deletion to any permission classifier
watching the sub-agent's tool calls (it was, in fact, exactly that). This
module makes the same operation a plain, testable Python function invoked
through a single named ``datum lane-cleanup`` CLI call — no LLM decides what
gets deleted, and no shell pattern-matching pipeline is handed to an agent.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

SCRIPT_TEST_PATTERN = re.compile(r"\.(test|spec)\.(ts|js|tsx|jsx)$|(^|/)test_.*\.py$")


def _normalize(path: str) -> str:
    return path.removeprefix("./").removeprefix("tests/").removeprefix("test/")


def find_untracked_files(worktree: Path) -> list[str]:
    """Untracked, non-ignored files under worktree's tests/ and src/ dirs."""
    result = subprocess.run(
        [
            "git",
            "-C",
            str(worktree),
            "ls-files",
            "--others",
            "--exclude-standard",
            "tests/",
            "src/",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return [line for line in result.stdout.splitlines() if line]


def stray_test_files(worktree: Path, allowed_test_files: list[str]) -> list[str]:
    """Untracked files matching the script-test pattern, minus the allowed set."""
    allowed = {p for f in allowed_test_files for p in (f, _normalize(f))}
    return [
        f
        for f in find_untracked_files(worktree)
        if SCRIPT_TEST_PATTERN.search(f)
        and f not in allowed
        and _normalize(f) not in allowed
    ]


def clean_lane_worktree(worktree: Path, allowed_test_files: list[str]) -> list[str]:
    """Delete stray untracked test-scaffold files. Returns the removed paths."""
    removed = []
    for rel in stray_test_files(worktree, allowed_test_files):
        path = worktree / rel
        if path.is_file():
            path.unlink()
            removed.append(rel)
    return removed
