"""Materialise compiled workflow skills into a repo-local directory (#353).

The Claude Code Workflow harness refuses any ``scriptPath`` whose *real*
path lies outside the session working directory (or an ``/add-dir``
directory). Symlinks are resolved before the check, so pointing
``skills_dir`` at the installed datum package — or symlinking it — fails
in every consumer repo. The fix is a plain copy of ``skills/datum-*.js``
into ``<repo>/.datum/skills/`` (gitignored by ``.datum/*``), which the
``sk()`` resolver in ``skills/src/datum-go.ts`` prefers when present.

Pure filesystem logic, no CLI concerns — ``datum init`` is the caller.
"""

# tested-by: tests/test_skills_materialize.py

from __future__ import annotations

import shutil
from pathlib import Path

LOCAL_SKILLS_SUBDIR = Path(".datum") / "skills"
SKILL_GLOB = "datum-*.js"


def materialize_skills(source: Path, dest: Path, *, force: bool = False) -> list[str]:
    """Copy ``datum-*.js`` from ``source`` into ``dest`` as real files.

    Returns the names that were (re)written. A file is rewritten when it is
    missing, when its bytes differ from the source, or always with ``force``.
    A missing ``source`` yields ``[]`` and creates nothing.
    """
    source = Path(source)
    if not source.is_dir():
        return []
    js_files = sorted(source.glob(SKILL_GLOB))
    if not js_files:
        return []

    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for src in js_files:
        target = dest / src.name
        if not force and target.is_file() and not target.is_symlink():
            if target.read_bytes() == src.read_bytes():
                continue
        if target.is_symlink() or target.exists():
            target.unlink()
        shutil.copyfile(src, target)
        written.append(src.name)
    return written


def resolve_skills_dir(
    repo_root: Path, package_skills_dir: Path, *, force: bool = False
) -> Path:
    """Decide where ``skills_dir`` should point for ``repo_root``.

    - Package skills already inside the repo (the datum repo itself): use
      them in place, so edits + rebuilds take effect without a refresh.
    - Otherwise: materialise into ``<repo>/.datum/skills`` and return that.
    """
    repo_root = Path(repo_root).resolve()
    package_skills_dir = Path(package_skills_dir).resolve()
    if package_skills_dir == repo_root or repo_root in package_skills_dir.parents:
        return package_skills_dir
    local = (repo_root / LOCAL_SKILLS_SUBDIR).resolve()
    materialize_skills(package_skills_dir, local, force=force)
    return local
