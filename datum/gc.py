"""datum.gc — Garbage collection for stale .datum/ artifacts.

Cleans up transcripts, agent checkpoints, failure records, and context
offload files past their configured retention windows.

Design:
  - Pure module: all filesystem interactions go through an injectable `Fs`
    interface so tests never need real files.
  - GcConfig: retention policy (days per category) + dry_run flag.
  - collect_stale: scans a datum_dir and returns items past their window.
  - purge: deletes (or dry-run reports) the collected items.
  - run_gc: one-shot entry point returning a GcResult.
  - format_gc_report: human-readable summary for CLI output.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, runtime_checkable

# ── Filesystem protocol (injectable for tests) ────────────────────────────


@runtime_checkable
class Fs(Protocol):
    """Minimal filesystem interface for GC operations."""

    def iterdir(self, path: Path) -> list[Path]: ...

    def mtime(self, path: Path) -> float: ...

    def unlink(self, path: Path) -> None: ...

    def exists(self, path: Path) -> bool: ...


class RealFs:
    """Production filesystem — delegates to pathlib/os."""

    def iterdir(self, path: Path) -> list[Path]:
        if not path.exists():
            return []
        return [p for p in path.iterdir() if p.is_file()]

    def mtime(self, path: Path) -> float:
        return path.stat().st_mtime

    def unlink(self, path: Path) -> None:
        path.unlink(missing_ok=True)

    def exists(self, path: Path) -> bool:
        return path.exists()


_REAL_FS = RealFs()


# ── Configuration ─────────────────────────────────────────────────────────


@dataclass
class GcConfig:
    """Retention policy for each artifact category.

    All *_retention_days values define the minimum age (inclusive boundary
    is NOT stale — a file must be strictly older than the window).
    """

    transcript_retention_days: int = 7
    """Keep transcripts/*.jsonl for this many days."""

    checkpoint_retention_days: int = 3
    """Keep agent-checkpoint-*.json for this many days."""

    failure_retention_days: int = 30
    """Keep failures/*.json for this many days."""

    context_retention_days: int = 1
    """Keep context/step-*.txt for this many days."""

    run_retention_days: int = 90
    """Keep completed run directories for this many days."""

    dry_run: bool = False
    """When True: scan and report but do not delete anything."""


# ── Result types ──────────────────────────────────────────────────────────


@dataclass
class GcResult:
    """Summary returned by run_gc."""

    items: list[dict]
    """Each item: {path, category, age_days}"""

    deleted_count: int
    """Number of files actually deleted (0 for dry_run=True)."""

    dry_run: bool


# ── Artifact category definitions ─────────────────────────────────────────

# Files in .datum/ root that must NEVER be collected regardless of age.
_PROTECTED_NAMES = frozenset(
    {
        "config.toml",
        "state.json",
        "state.db",
        "state.db-shm",
        "state.db-wal",
        "tdd-failure.json",
        "tdd-success.json",
        "todos.json",
        "routing.json",
        "rules-hash.json",
        "landscape-hash",
        "landscape-cache.md",
        "lane-plan.json",
        "local-llm-metrics.jsonl",
    }
)


def _is_protected(path: Path) -> bool:
    return path.name in _PROTECTED_NAMES


# ── Core helpers ──────────────────────────────────────────────────────────


def is_stale(mtime: float, retention_days: int) -> bool:
    """Return True if the file is strictly older than retention_days.

    The boundary is exclusive: a file exactly ``retention_days`` old is
    *not* stale (age_days == retention_days → keep).
    """
    now = datetime.now(tz=UTC).timestamp()
    age_seconds = now - mtime
    # Use a 1-second grace buffer so files exactly at the boundary window
    # are never considered stale despite sub-second clock jitter.
    return age_seconds > (retention_days * 86400 + 1)


def _age_days(mtime: float) -> int:
    now = datetime.now(tz=UTC).timestamp()
    return int((now - mtime) / 86400.0)


# ── Collectors ────────────────────────────────────────────────────────────


def _collect_dir(
    subdir: Path,
    pattern: str,
    category: str,
    retention_days: int,
    fs: Fs,
) -> list[dict]:
    """Collect stale files matching a glob pattern in a subdirectory."""
    items: list[dict] = []
    for path in fs.iterdir(subdir):
        if not fnmatch.fnmatch(path.name, pattern):
            continue
        if _is_protected(path):
            continue
        mt = fs.mtime(path)
        if is_stale(mt, retention_days):
            items.append(
                {
                    "path": path,
                    "category": category,
                    "age_days": _age_days(mt),
                }
            )
    return items


def _collect_root_pattern(
    datum_dir: Path,
    pattern: str,
    category: str,
    retention_days: int,
    fs: Fs,
) -> list[dict]:
    """Collect stale files matching a pattern directly under datum_dir."""
    items: list[dict] = []
    for path in fs.iterdir(datum_dir):
        if not fnmatch.fnmatch(path.name, pattern):
            continue
        if _is_protected(path):
            continue
        mt = fs.mtime(path)
        if is_stale(mt, retention_days):
            items.append(
                {
                    "path": path,
                    "category": category,
                    "age_days": _age_days(mt),
                }
            )
    return items


def collect_stale(
    datum_dir: Path,
    cfg: GcConfig,
    *,
    fs: Fs | None = None,
) -> list[dict]:
    """Scan datum_dir and return all stale artifact items.

    Each item is a dict with keys: path (Path), category (str), age_days (int).
    Protected files (config.toml, state.json, etc.) are never returned.

    Parameters
    ----------
    datum_dir:
        Root of the .datum directory to scan.
    cfg:
        Retention policy configuration.
    fs:
        Injectable filesystem. Defaults to the real filesystem.
    """
    _fs = fs if fs is not None else _REAL_FS
    results: list[dict] = []

    # Transcripts: .datum/transcripts/*.jsonl
    results.extend(
        _collect_dir(
            datum_dir / "transcripts",
            "*.jsonl",
            "transcript",
            cfg.transcript_retention_days,
            _fs,
        )
    )

    # Agent checkpoints: .datum/agent-checkpoint-*.json
    results.extend(
        _collect_root_pattern(
            datum_dir,
            "agent-checkpoint-*.json",
            "checkpoint",
            cfg.checkpoint_retention_days,
            _fs,
        )
    )

    # Failure records: .datum/failures/*.json
    results.extend(
        _collect_dir(
            datum_dir / "failures",
            "*.json",
            "failure",
            cfg.failure_retention_days,
            _fs,
        )
    )

    # Context offload files: .datum/context/step-*.txt
    results.extend(
        _collect_dir(
            datum_dir / "context",
            "step-*.txt",
            "context",
            cfg.context_retention_days,
            _fs,
        )
    )

    return results


# ── Purge ─────────────────────────────────────────────────────────────────


def purge(
    stale_items: list[dict],
    cfg: GcConfig,
    *,
    fs: Fs | None = None,
) -> list[Path]:
    """Delete stale files (or simulate deletion for dry_run).

    Returns the list of paths that were (or would be) deleted.
    """
    _fs = fs if fs is not None else _REAL_FS
    deleted: list[Path] = []

    for item in stale_items:
        path: Path = item["path"]
        if not cfg.dry_run:
            _fs.unlink(path)
        deleted.append(path)

    return deleted


# ── Top-level entry point ─────────────────────────────────────────────────


def run_gc(
    datum_dir: Path,
    cfg: GcConfig,
    *,
    fs: Fs | None = None,
) -> GcResult:
    """Run a full garbage-collection pass on datum_dir.

    Parameters
    ----------
    datum_dir:
        Root .datum/ directory to clean.
    cfg:
        Retention and dry_run policy.
    fs:
        Injectable filesystem (defaults to real FS).

    Returns
    -------
    GcResult
        Summary of items collected and deletion count.
    """
    _fs = fs if fs is not None else _REAL_FS
    stale = collect_stale(datum_dir, cfg, fs=_fs)
    deleted = purge(stale, cfg, fs=_fs)

    return GcResult(
        items=stale,
        deleted_count=len(deleted),
        dry_run=cfg.dry_run,
    )


# ── Report formatter ──────────────────────────────────────────────────────


def format_gc_report(result: GcResult) -> str:
    """Render a human-readable GC summary string.

    Used by the CLI and for testing without Rich.
    """
    lines: list[str] = []

    mode = "[dry-run]" if result.dry_run else "[live]"
    verb = "Would delete" if result.dry_run else "Deleted"

    if result.deleted_count == 0 and not result.items:
        return f"{mode} Nothing to collect — all artifacts within retention windows."

    # Group by category
    by_cat: dict[str, list[dict]] = {}
    for item in result.items:
        by_cat.setdefault(item["category"], []).append(item)

    lines.append(f"{mode} {verb} {result.deleted_count} artifact(s):")
    for category, items in sorted(by_cat.items()):
        lines.append(f"  {category} ({len(items)}):")
        for item in items:
            lines.append(f"    {item['path'].name}  [{item['age_days']}d old]")

    return "\n".join(lines)
