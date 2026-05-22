#!/usr/bin/env python3
"""Shared path helpers for DATUM runtime artifacts."""

from __future__ import annotations

import json
from pathlib import Path

DATUM_DIR = Path(".datum")
RUNS_DIR = DATUM_DIR / "runs"
STATE_FILE = DATUM_DIR / "state.json"


def skill_root() -> Path:
    """Absolute path to the skill root (the repository root)."""
    return Path(__file__).resolve().parent.parent


def assets_dir() -> Path:
    """Absolute path to the skill assets directory."""
    return skill_root() / "assets"

def templates_dir() -> Path:
    """Absolute path to the skill templates directory."""
    return skill_root() / "templates"


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except json.JSONDecodeError:
        return {}


def current_run_id() -> str | None:
    state = load_state()
    run_id = state.get("run_id")
    return run_id if isinstance(run_id, str) and run_id else None


def run_dir(run_id: str) -> Path:
    return RUNS_DIR / run_id


def review_packets_dir(run_id: str | None = None) -> Path:
    resolved = run_id or current_run_id()
    if resolved:
        return run_dir(resolved) / "review-packets"
    return DATUM_DIR / "review-packets"


def legacy_review_packets_dir() -> Path:
    return DATUM_DIR / "review-packets"


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
    archived = run_dir(run_id) / "state.json"
    return archived if archived.exists() else STATE_FILE
