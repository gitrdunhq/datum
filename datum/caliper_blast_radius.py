"""Caliper blast-radius write-time advisory (issue #83).

Integrates caliper's CodeGraph for per-write impact analysis in the agent
loop.  Advisory only — findings become WARNING lines in the observation,
never block execution.

FAIL OPEN: any caliper exception is logged to transcript (if available) and
silently skipped in the observation.  If caliper is not installed, the module
degrades to no-ops.
"""

from __future__ import annotations

import time
from pathlib import Path

# Graceful degradation: caliper is an optional dependency.
_CALIPER_AVAILABLE = False
_CodeGraph = None

try:
    from caliper.plugins._runners.graph_builder import CodeGraph as _CG

    _CodeGraph = _CG
    _CALIPER_AVAILABLE = True
except ImportError:
    pass

_DEFAULT_DB_NAME = "caliper-graph.sqlite"
_RUN_CHECKS_TIMEOUT_S = 1.0


def caliper_available() -> bool:
    """Return True if caliper is installed and importable."""
    return _CALIPER_AVAILABLE


def init_code_graph(
    repo_dir: str | Path,
    db_name: str = _DEFAULT_DB_NAME,
) -> object | None:
    """Build or refresh the code graph for a repo directory.

    Returns the CodeGraph instance, or None if caliper is unavailable.
    The database is stored at <repo_dir>/.datum/<db_name>.
    """
    if not _CALIPER_AVAILABLE or _CodeGraph is None:
        return None

    try:
        repo = Path(repo_dir)
        db_dir = repo / ".datum"
        db_dir.mkdir(parents=True, exist_ok=True)
        db_path = str(db_dir / db_name)

        graph = _CodeGraph(db_path=db_path)

        if graph.stats()["symbols"] == 0:
            graph.index_directory(repo)

        return graph
    except Exception:
        return None


def check_written_file(
    graph: object | None,
    file_path: str | Path,
    repo_dir: str | Path,
) -> list[str]:
    """Run blast-radius checks on a just-written file.

    Returns a list of WARNING strings suitable for appending to the
    write observation.  Returns [] on any failure (fail open).
    """
    if graph is None or not _CALIPER_AVAILABLE or _CodeGraph is None:
        return []

    try:
        repo = Path(repo_dir)
        abs_path = (repo / file_path).resolve()
        rel_path = str(abs_path.relative_to(repo.resolve()))

        t0 = time.monotonic()

        # Rebuild the graph for the changed file (absolute path for
        # disk access; the graph stores the path as-is for rebuild).
        graph.rebuild_incremental([str(abs_path)])

        # Run checks against relative path (matches index_directory's
        # storage convention).
        findings = graph.run_checks([rel_path])

        elapsed = time.monotonic() - t0

        warnings: list[str] = []
        for f in findings:
            severity = f.get("severity", "info")
            check = f.get("check", "unknown")
            name = f.get("name", "")
            desc = f.get("description", "")
            detail = f" ({name})" if name else ""
            warnings.append(
                f"[caliper blast-radius] {severity}: {check}{detail} — {desc}"
            )

        if elapsed > _RUN_CHECKS_TIMEOUT_S and not warnings:
            # Performance note: if checks are slow but found nothing,
            # don't pollute the observation.
            pass

        return warnings
    except Exception:
        return []
