"""Data layer — reads .datum/ files without importing the datum package."""

from __future__ import annotations

import json
import os
from pathlib import Path


def _project_root() -> Path:
    return Path(os.environ.get("DATUM_PROJECT_DIR", "."))


def _datum_dir() -> Path:
    return _project_root() / ".datum"


def load_state() -> dict:
    sf = _datum_dir() / "state.json"
    if not sf.exists():
        return {}
    try:
        return json.loads(sf.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def load_config() -> dict:
    for path in [_datum_dir() / "config.toml", Path("assets/config.toml.default")]:
        if not path.exists():
            continue
        try:
            import tomllib
        except ImportError:
            try:
                import tomli as tomllib
            except ImportError:
                return {}
        with path.open("rb") as f:
            return tomllib.load(f)
    return {}


def load_metrics() -> dict:
    mp = _datum_dir() / "local-llm-metrics.jsonl"
    if not mp.exists():
        return {
            "total_calls": 0,
            "total_tokens": 0,
            "total_time_s": 0,
            "escalated": 0,
            "success_rate_pct": 0,
            "estimated_savings_usd": 0,
            "avg_tokens_per_sec": 0,
        }

    calls = []
    for line in mp.read_text().splitlines():
        if line.strip():
            try:
                calls.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not calls:
        return {
            "total_calls": 0,
            "total_tokens": 0,
            "total_time_s": 0,
            "escalated": 0,
            "success_rate_pct": 0,
            "estimated_savings_usd": 0,
            "avg_tokens_per_sec": 0,
        }

    total_tokens = sum(c.get("tokens", 0) for c in calls)
    total_time = sum(c.get("time_s", 0) for c in calls)
    escalated = sum(1 for c in calls if c.get("escalated"))

    return {
        "total_calls": len(calls),
        "total_tokens": total_tokens,
        "total_time_s": round(total_time, 1),
        "avg_tokens_per_sec": (
            round(total_tokens / total_time, 1) if total_time > 0 else 0
        ),
        "escalated": escalated,
        "success_rate_pct": (
            round((len(calls) - escalated) / len(calls) * 100, 1) if calls else 0
        ),
        "estimated_savings_usd": round(total_tokens * 3.0 / 1_000_000, 4),
    }


def load_events(limit: int = 50) -> list[dict]:
    ef = _datum_dir() / "events.jsonl"
    if not ef.exists():
        return []
    lines = ef.read_text().splitlines()
    events = []
    for line in lines[-limit:]:
        if line.strip():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def load_lanes() -> list[dict]:
    state = load_state()
    lanes = state.get("lanes", {})
    return [
        {
            "id": lid,
            "stage": lane.get("stage", "queued"),
            "status": lane.get("status", ""),
            "title": lane.get("title", lid),
        }
        for lid, lane in lanes.items()
    ]


def load_epics() -> list[str]:
    epics_dir = _project_root() / "docs" / "epics"
    if not epics_dir.exists():
        return []
    return sorted(
        [d.name for d in epics_dir.iterdir() if d.is_dir()],
        reverse=True,
    )[:10]


def load_current_state() -> str:
    cs = _project_root() / "CURRENT_STATE.md"
    if cs.exists():
        return cs.read_text()[:500]
    return "No CURRENT_STATE.md"
