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


def prune_stale_skills(source: Path, dest: Path) -> list[str]:
    """Remove ``datum-*.js`` in ``dest`` that no longer exist in ``source``.

    A bundle deleted upstream (datum-route.js) survived ``datum init
    --refresh`` in a consumer repo — a producer nothing calls, shipped
    anyway. Only compiled bundles are touched; anything else in ``dest``
    is left alone. Returns the removed names; a missing ``dest`` yields [].
    """
    source = Path(source)
    dest = Path(dest)
    if not dest.is_dir():
        return []
    current = {p.name for p in source.glob(SKILL_GLOB)} if source.is_dir() else set()
    pruned: list[str] = []
    for stale in sorted(dest.glob(SKILL_GLOB)):
        if stale.name not in current:
            stale.unlink()
            pruned.append(stale.name)
    return pruned


def prune_dangling_workflow_links(workflows_dir: Path) -> list[str]:
    """Remove ``datum-*.js`` symlinks in ``workflows_dir`` whose target is gone.

    ``datum install`` symlinks every bundle into ``~/.claude/workflows``; a
    bundle deleted upstream leaves a dangling link there. Only datum's own
    dangling links are removed — real files and other tools' links are kept.
    """
    workflows_dir = Path(workflows_dir)
    if not workflows_dir.is_dir():
        return []
    pruned: list[str] = []
    for link in sorted(workflows_dir.glob(SKILL_GLOB)):
        if link.is_symlink() and not link.exists():
            link.unlink()
            pruned.append(link.name)
    return pruned


def resolve_skills_dir(
    repo_root: Path, package_skills_dir: Path, *, force: bool = False
) -> Path:
    """Decide where ``skills_dir`` should point for ``repo_root``.

    - Package skills already inside the repo (the datum repo itself): use
      them in place, so edits + rebuilds take effect without a refresh.
    - Otherwise: materialise into ``<repo>/.datum/skills`` (pruning bundles
      that no longer ship) and return that.
    """
    repo_root = Path(repo_root).resolve()
    package_skills_dir = Path(package_skills_dir).resolve()
    if package_skills_dir == repo_root or repo_root in package_skills_dir.parents:
        return package_skills_dir
    local = (repo_root / LOCAL_SKILLS_SUBDIR).resolve()
    materialize_skills(package_skills_dir, local, force=force)
    prune_stale_skills(package_skills_dir, local)
    return local
