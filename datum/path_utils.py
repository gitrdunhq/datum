#!/usr/bin/env python3
"""Shared path helpers for DATUM runtime artifacts.

Every .datum/ path goes through project_root(). The CLI wrapper sets
DATUM_PROJECT_DIR to the user's cwd before switching to the datum repo
via --directory. All paths resolve relative to the project, not the
datum package. For live state (not archival paths), see datum/state.py —
that module is the single source of truth for state resolution.
"""

from __future__ import annotations

import os
from pathlib import Path


def project_root() -> Path:
    """The target project's root — where .datum/ and docs/ live."""
    return Path(os.environ.get("DATUM_PROJECT_DIR", "."))


def datum_dir() -> Path:
    return project_root() / ".datum"


def runs_dir() -> Path:
    return datum_dir() / "runs"


def __getattr__(name: str):
    """Lazy module attributes — resolve at access time, not import time."""
    if name == "DATUM_DIR":
        return datum_dir()
    if name == "RUNS_DIR":
        return runs_dir()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def skill_root() -> Path:
    """Absolute path to the skill root."""
    return Path(__file__).resolve().parent.parent


def assets_dir() -> Path:
    """Absolute path to the skill assets directory."""
    return skill_root() / "assets"


def templates_dir() -> Path:
    """Absolute path to the skill templates directory."""
    return skill_root() / "templates"


def run_dir(run_id: str) -> Path:
    return runs_dir() / run_id


def _live_run_id() -> str | None:
    from datum.state import load_state

    run_id = load_state().get("run_id")
    return run_id if isinstance(run_id, str) and run_id else None


def review_packets_dir(run_id: str | None = None) -> Path:
    resolved = run_id or _live_run_id()
    if resolved:
        return run_dir(resolved) / "review-packets"
    return datum_dir() / "review-packets"


def legacy_review_packets_dir() -> Path:
    return datum_dir() / "review-packets"


def existing_review_packets_dir(run_id: str | None = None) -> Path:
    primary = review_packets_dir(run_id)
    if primary.exists():
        return primary
    legacy = legacy_review_packets_dir()
    if legacy.exists():
        return legacy
    return primary


def closeout_raw_dir(run_id: str) -> Path:
    return run_dir(run_id) / "closeout-raw"


def collector_marker(run_id: str, name: str) -> Path:
    return run_dir(run_id) / f".collect-{name}.done"


def state_for_run(run_id: str) -> Path:
    """The run's archival state export. Never the live `.datum/state.json`
    (removed by the state-single-source-of-truth epic); a collector that
    needs state before the archive exists reads datum.state.load_state()
    via datum.closeout.state_source."""
    return run_dir(run_id) / "state.json"
