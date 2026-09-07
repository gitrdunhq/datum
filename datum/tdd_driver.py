"""tdd_driver.py — TDD-phase driver preflight utilities.

Preflight check that runs before an agent_loop episode begins.  If the
target repo's working tree is dirty (uncommitted changes, untracked files
in tracked directories) the check raises DirtyWorkingTreeError listing
every dirty path, rather than letting the agent silently build on top of
someone's half-finished work.

Wiring: call check_clean_working_tree(repo_path) at the start of any TDD
driver before invoking agent_loop().  Pass allow_dirty=True to bypass the
guard (e.g. for CI environments that manage state externally).

.datum/ paths are excluded from the dirty check — datum's own runtime files
(transcripts, locks, run artefacts) must never trip the guard.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


class DirtyWorkingTreeError(RuntimeError):
    """Raised when the target repo has uncommitted changes at episode start.

    The message lists every dirty path so the user knows exactly what to
    commit or stash before re-running.
    """


def _git_status_porcelain(repo_path: Path) -> str:
    """Return the raw ``git status --porcelain`` output for *repo_path*.

    Returns the unfiltered output; callers are responsible for ignoring
    paths that should not trip the dirty check.
    """
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
        cwd=repo_path,
    )
    return result.stdout


def _extract_path(line: str) -> str:
    """Extract the file path from a porcelain status line.

    Porcelain v1 format: XY SP path  (columns 0-1 status, col 2 space).
    """
    return line[3:] if len(line) > 3 else line


def check_clean_working_tree(
    repo_path: Path,
    *,
    allow_dirty: bool = False,
) -> None:
    """Assert that *repo_path*'s working tree has no uncommitted changes.

    Raises DirtyWorkingTreeError listing every dirty file if the tree is
    dirty and *allow_dirty* is False.  Silently returns when clean or when
    *allow_dirty=True*.

    .datum/ paths are excluded — datum runtime files must not trip this guard.
    """
    if allow_dirty:
        return

    raw = _git_status_porcelain(repo_path)
    dirty_lines = []
    for line in raw.splitlines():
        path = _extract_path(line)
        if not path or path.startswith(".datum/"):
            continue
        dirty_lines.append(line)

    if not dirty_lines:
        return

    dirty_files = [_extract_path(line) for line in dirty_lines]
    file_list = "\n  ".join(dirty_files)
    raise DirtyWorkingTreeError(
        f"Working tree is dirty — commit or stash changes before running the "
        f"TDD driver.\n\nDirty files in {repo_path}:\n  {file_list}"
    )


# ---------------------------------------------------------------------------
# SPM subpackage detection — issue #131
# ---------------------------------------------------------------------------


def detect_spm_subpackage(file_path: Path) -> Path | None:
    """Walk up from *file_path* to find the nearest ``Package.swift``.

    In SPM monorepos, test files live under a subpackage that has its own
    ``Package.swift`` with a different dependency graph than the root workspace.
    SourceKit resolves imports against the root ``Package.swift``, which
    produces false-positive "No such module" errors for modules that are valid
    transitive dependencies of the subpackage.

    Returns the directory containing the nearest ``Package.swift``, or
    ``None`` if no ``Package.swift`` is found before hitting the filesystem
    root.  The orchestrator can then:

    1. Read that ``Package.swift`` to extract the target's dependency list.
    2. Inject the dependency list into the agent brief so the agent knows
       which imports are legitimate.
    3. Use ``swift test --package-path <returned_dir>`` instead of relying
       on SourceKit diagnostics.

    See: https://github.com/gitrdunhq/datum/issues/131
    """
    current = file_path.resolve()
    if current.is_file():
        current = current.parent

    while current != current.parent:
        if (current / "Package.swift").exists():
            return current
        current = current.parent

    return None


def get_spm_test_command(file_path: Path) -> list[str] | None:
    """Return the ``swift test`` command scoped to the subpackage owning *file_path*.

    Returns ``None`` if no ``Package.swift`` is found (not an SPM project).
    The caller should use this instead of a bare ``swift test`` to get
    ground-truth compiler output rather than SourceKit diagnostics.
    """
    subpackage = detect_spm_subpackage(file_path)
    if subpackage is None:
        return None
    return ["swift", "test", "--package-path", str(subpackage)]
