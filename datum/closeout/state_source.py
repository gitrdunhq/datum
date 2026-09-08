"""Where a closeout collector reads run state from.

ARCH-001 (#341 review): collectors run before archive.py writes
`.datum/runs/<run_id>/state.json`, and the live `.datum/state.json` they
used to fall back to no longer exists. The archival export wins when it is
there; otherwise the canonical accessor is the only other source.
"""

from __future__ import annotations

import json
from pathlib import Path

import datum.state as state_mod
from datum.path_utils import state_for_run


def load_run_state(run_id: str) -> tuple[dict, str | None]:
    """Return (state, source): the archived export if present, else the
    canonical store via load_state() (source "state.db"), else ({}, None)."""
    archived: Path = state_for_run(run_id)
    if archived.exists():
        return json.loads(archived.read_text()), str(archived)
    try:
        state = state_mod.load_state()
    except Exception:
        return {}, None
    if state:
        return state, str(state_mod.DB_FILE)
    return {}, None
