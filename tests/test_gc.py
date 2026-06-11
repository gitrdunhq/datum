"""TDD tests for datum.gc — garbage collection of stale .datum artifacts.

RED phase: all tests must fail before datum/gc.py exists.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

# ── The public API we expect to exist ────────────────────────────────────


class _FS(Protocol):
    """Injectable filesystem interface for gc operations."""

    def iterdir(self, path: Path) -> list[Path]: ...
    def mtime(self, path: Path) -> float: ...
    def unlink(self, path: Path) -> None: ...
    def exists(self, path: Path) -> bool: ...


# ── Test the GcConfig dataclass ───────────────────────────────────────────


def test_gc_config_defaults():
    """GcConfig has sensible defaults."""
    from datum.gc import GcConfig

    cfg = GcConfig()
    assert cfg.transcript_retention_days == 7
    assert cfg.checkpoint_retention_days == 3
    assert cfg.failure_retention_days == 30
    assert cfg.context_retention_days == 1
    assert cfg.run_retention_days == 90
    assert cfg.dry_run is False


def test_gc_config_custom():
    """GcConfig accepts custom values."""
    from datum.gc import GcConfig

    cfg = GcConfig(
        transcript_retention_days=14,
        checkpoint_retention_days=7,
        failure_retention_days=60,
        context_retention_days=2,
        run_retention_days=30,
        dry_run=True,
    )
    assert cfg.transcript_retention_days == 14
    assert cfg.dry_run is True


# ── Test artifact age classification ─────────────────────────────────────


def test_is_stale_returns_true_for_old_file():
    """Files older than the retention window are stale."""
    from datum.gc import is_stale

    old_mtime = (datetime.now(tz=UTC) - timedelta(days=10)).timestamp()
    assert is_stale(old_mtime, retention_days=7) is True


def test_is_stale_returns_false_for_fresh_file():
    """Files within the retention window are not stale."""
    from datum.gc import is_stale

    fresh_mtime = (datetime.now(tz=UTC) - timedelta(days=3)).timestamp()
    assert is_stale(fresh_mtime, retention_days=7) is False


def test_is_stale_boundary_is_exclusive():
    """A file exactly at the boundary (equal days) is not stale."""
    from datum.gc import is_stale

    boundary_mtime = (datetime.now(tz=UTC) - timedelta(days=7)).timestamp()
    assert is_stale(boundary_mtime, retention_days=7) is False


# ── FakeFS for injectable tests ───────────────────────────────────────────


class FakeFS:
    """In-memory filesystem fake for tests."""

    def __init__(self, files: dict[Path, float]):
        """files: path -> mtime (unix timestamp)"""
        self._files = dict(files)
        self.deleted: list[Path] = []

    def iterdir(self, path: Path) -> list[Path]:
        return [p for p in self._files if p.parent == path]

    def mtime(self, path: Path) -> float:
        return self._files[path]

    def unlink(self, path: Path) -> None:
        self.deleted.append(path)
        del self._files[path]

    def exists(self, path: Path) -> bool:
        return path in self._files


def _old_mtime(days: int) -> float:
    return (datetime.now(tz=UTC) - timedelta(days=days)).timestamp()


def _new_mtime(days: int = 1) -> float:
    return (datetime.now(tz=UTC) - timedelta(days=days)).timestamp()


# ── Test collect_stale ────────────────────────────────────────────────────


def test_collect_stale_transcripts():
    """collect_stale finds old .jsonl transcript files."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")
    transcripts_dir = datum_dir / "transcripts"

    old = transcripts_dir / "20260101T000000Z-act_red.jsonl"
    fresh = transcripts_dir / "20260610T000000Z-act_green.jsonl"

    fs = FakeFS(
        {
            old: _old_mtime(15),
            fresh: _new_mtime(2),
        }
    )

    cfg = GcConfig(transcript_retention_days=7)
    results = collect_stale(datum_dir, cfg, fs=fs)

    stale_paths = [r["path"] for r in results]
    assert old in stale_paths
    assert fresh not in stale_paths


def test_collect_stale_checkpoints():
    """collect_stale finds old agent-checkpoint-*.json files."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")

    old_cp = datum_dir / "agent-checkpoint-abc123.json"
    fresh_cp = datum_dir / "agent-checkpoint-def456.json"

    fs = FakeFS(
        {
            old_cp: _old_mtime(10),
            fresh_cp: _new_mtime(1),
        }
    )

    cfg = GcConfig(checkpoint_retention_days=3)
    results = collect_stale(datum_dir, cfg, fs=fs)

    stale_paths = [r["path"] for r in results]
    assert old_cp in stale_paths
    assert fresh_cp not in stale_paths


def test_collect_stale_failures():
    """collect_stale finds old .datum/failures/*.json files."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")
    failures_dir = datum_dir / "failures"

    old_fail = failures_dir / "failure-20260101T000000Z.json"
    fresh_fail = failures_dir / "failure-20260610T000000Z.json"

    fs = FakeFS(
        {
            old_fail: _old_mtime(40),
            fresh_fail: _new_mtime(5),
        }
    )

    cfg = GcConfig(failure_retention_days=30)
    results = collect_stale(datum_dir, cfg, fs=fs)

    stale_paths = [r["path"] for r in results]
    assert old_fail in stale_paths
    assert fresh_fail not in stale_paths


def test_collect_stale_context_files():
    """collect_stale finds old .datum/context/step-*.txt files."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")
    context_dir = datum_dir / "context"

    old_ctx = context_dir / "step-001.txt"
    fresh_ctx = context_dir / "step-999.txt"

    fs = FakeFS(
        {
            old_ctx: _old_mtime(3),
            fresh_ctx: _new_mtime(0),  # today
        }
    )

    cfg = GcConfig(context_retention_days=1)
    results = collect_stale(datum_dir, cfg, fs=fs)

    stale_paths = [r["path"] for r in results]
    assert old_ctx in stale_paths
    assert fresh_ctx not in stale_paths


def test_collect_stale_returns_artifact_category():
    """Each result item includes a 'category' field."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")
    transcripts_dir = datum_dir / "transcripts"
    old = transcripts_dir / "20260101T000000Z-act_red.jsonl"

    fs = FakeFS({old: _old_mtime(15)})

    cfg = GcConfig(transcript_retention_days=7)
    results = collect_stale(datum_dir, cfg, fs=fs)

    assert results[0]["category"] == "transcript"


def test_collect_stale_returns_age_days():
    """Each result item includes an 'age_days' field."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")
    transcripts_dir = datum_dir / "transcripts"
    old = transcripts_dir / "20260101T000000Z-act_red.jsonl"

    fs = FakeFS({old: _old_mtime(20)})

    cfg = GcConfig(transcript_retention_days=7)
    results = collect_stale(datum_dir, cfg, fs=fs)

    assert results[0]["age_days"] >= 20


def test_collect_stale_empty_datum_dir():
    """collect_stale handles an empty .datum dir without error."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")
    fs = FakeFS({})

    cfg = GcConfig()
    results = collect_stale(datum_dir, cfg, fs=fs)
    assert results == []


def test_collect_stale_does_not_touch_protected_files():
    """config.toml, state.json, state.db, etc. are never collected."""
    from datum.gc import GcConfig, collect_stale

    datum_dir = Path("/proj/.datum")
    protected = [
        datum_dir / "config.toml",
        datum_dir / "state.json",
        datum_dir / "state.db",
        datum_dir / "tdd-failure.json",
        datum_dir / "tdd-success.json",
        datum_dir / "todos.json",
        datum_dir / "routing.json",
        datum_dir / "rules-hash.json",
    ]

    fs = FakeFS({p: _old_mtime(365) for p in protected})

    cfg = GcConfig()
    results = collect_stale(datum_dir, cfg, fs=fs)

    # No protected file should appear in stale results
    stale_paths = {r["path"] for r in results}
    for p in protected:
        assert p not in stale_paths, f"{p.name} should never be collected"


# ── Test purge ────────────────────────────────────────────────────────────


def test_purge_deletes_stale_files():
    """purge removes files identified by collect_stale when dry_run=False."""
    from datum.gc import GcConfig, collect_stale, purge

    datum_dir = Path("/proj/.datum")
    transcripts_dir = datum_dir / "transcripts"
    old = transcripts_dir / "20260101T000000Z-act_red.jsonl"

    fs = FakeFS({old: _old_mtime(15)})

    cfg = GcConfig(transcript_retention_days=7, dry_run=False)
    stale = collect_stale(datum_dir, cfg, fs=fs)
    deleted = purge(stale, cfg, fs=fs)

    assert old in deleted
    assert old not in fs._files


def test_purge_dry_run_does_not_delete():
    """purge with dry_run=True reports files without deleting them."""
    from datum.gc import GcConfig, collect_stale, purge

    datum_dir = Path("/proj/.datum")
    transcripts_dir = datum_dir / "transcripts"
    old = transcripts_dir / "20260101T000000Z-act_red.jsonl"

    fs = FakeFS({old: _old_mtime(15)})

    cfg = GcConfig(transcript_retention_days=7, dry_run=True)
    stale = collect_stale(datum_dir, cfg, fs=fs)
    deleted = purge(stale, cfg, fs=fs)

    # dry run still returns what WOULD be deleted
    assert old in deleted
    # but file is still present
    assert old in fs._files


# ── Test run_gc top-level function ────────────────────────────────────────


def test_run_gc_returns_gc_result():
    """run_gc returns a GcResult with counts."""
    from datum.gc import GcConfig, GcResult, run_gc

    datum_dir = Path("/proj/.datum")
    transcripts_dir = datum_dir / "transcripts"
    old = transcripts_dir / "20260101T000000Z-act_red.jsonl"
    fresh = transcripts_dir / "20260610T000000Z-act_green.jsonl"

    fs = FakeFS(
        {
            old: _old_mtime(15),
            fresh: _new_mtime(2),
        }
    )

    cfg = GcConfig(transcript_retention_days=7, dry_run=False)
    result = run_gc(datum_dir, cfg, fs=fs)

    assert isinstance(result, GcResult)
    assert result.deleted_count == 1
    assert result.dry_run is False
    assert len(result.items) == 1
    assert result.items[0]["path"] == old


def test_run_gc_dry_run_returns_would_delete():
    """run_gc with dry_run=True returns items without deleting."""
    from datum.gc import GcConfig, run_gc

    datum_dir = Path("/proj/.datum")
    transcripts_dir = datum_dir / "transcripts"
    old = transcripts_dir / "20260101T000000Z-act_red.jsonl"

    fs = FakeFS({old: _old_mtime(15)})

    cfg = GcConfig(transcript_retention_days=7, dry_run=True)
    result = run_gc(datum_dir, cfg, fs=fs)

    assert result.deleted_count == 1
    assert result.dry_run is True
    # File still exists — dry run only
    assert fs.exists(old)


def test_run_gc_multiple_categories():
    """run_gc collects across all categories in one pass."""
    from datum.gc import GcConfig, run_gc

    datum_dir = Path("/proj/.datum")

    old_transcript = datum_dir / "transcripts" / "20260101T000000Z-act_red.jsonl"
    old_checkpoint = datum_dir / "agent-checkpoint-stale.json"
    old_failure = datum_dir / "failures" / "failure-old.json"
    fresh_transcript = datum_dir / "transcripts" / "20260610T000000Z-act_green.jsonl"

    fs = FakeFS(
        {
            old_transcript: _old_mtime(15),
            old_checkpoint: _old_mtime(10),
            old_failure: _old_mtime(35),
            fresh_transcript: _new_mtime(2),
        }
    )

    cfg = GcConfig(
        transcript_retention_days=7,
        checkpoint_retention_days=3,
        failure_retention_days=30,
        dry_run=True,
    )
    result = run_gc(datum_dir, cfg, fs=fs)

    stale_paths = {item["path"] for item in result.items}
    assert old_transcript in stale_paths
    assert old_checkpoint in stale_paths
    assert old_failure in stale_paths
    assert fresh_transcript not in stale_paths


# ── Test format_gc_report ─────────────────────────────────────────────────


def test_format_gc_report_dry_run_prefix():
    """format_gc_report marks dry-run output clearly."""
    from datum.gc import GcResult, format_gc_report

    result = GcResult(
        items=[
            {
                "path": Path("/proj/.datum/transcripts/old.jsonl"),
                "category": "transcript",
                "age_days": 15,
            }
        ],
        deleted_count=1,
        dry_run=True,
    )
    report = format_gc_report(result)
    assert "dry run" in report.lower() or "dry-run" in report.lower()
    assert "1" in report


def test_format_gc_report_nothing_to_collect():
    """format_gc_report handles empty results gracefully."""
    from datum.gc import GcResult, format_gc_report

    result = GcResult(items=[], deleted_count=0, dry_run=False)
    report = format_gc_report(result)
    assert "nothing" in report.lower() or "0" in report


def test_format_gc_report_lists_categories():
    """format_gc_report groups items by category."""
    from datum.gc import GcResult, format_gc_report

    result = GcResult(
        items=[
            {
                "path": Path("/p/.datum/transcripts/a.jsonl"),
                "category": "transcript",
                "age_days": 10,
            },
            {
                "path": Path("/p/.datum/failures/b.json"),
                "category": "failure",
                "age_days": 35,
            },
        ],
        deleted_count=2,
        dry_run=False,
    )
    report = format_gc_report(result)
    assert "transcript" in report.lower()
    assert "failure" in report.lower()
