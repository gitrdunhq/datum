"""task-INT-8: integration invariants covering task-002, task-003.

INV-4: `report_bug.py` and `archive.py` contain zero live
`.datum/state.json` literal reads after migration — both modules must
derive run/state information exclusively through
`datum.state.load_state()` (backed by `.datum/state.db`), never by opening
the legacy write-through JSON cache directly.

This is an integration lane: these tests exercise already-merged code from
task-002 and task-003 and are expected to PASS. A failure here is a real
finding about the migration boundary, not a test to weaken.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import datum.archive as archive_mod
import datum.state as state_mod
from datum.report_bug import _build_body

_DECOY_RUN_ID = "LEGACY-DECOY-DO-NOT-READ"
_DECOY_PHASE = "legacy-decoy-phase"


def _seed_real_state_and_poison_json_cache(
    tmp_path: Path, run_id: str, phase: str
) -> None:
    """Write the canonical state via save_state(), then overwrite the
    legacy write-through `.datum/state.json` cache with decoy values that
    diverge from the canonical store. Any module that still performs a
    live literal read of `.datum/state.json` will observe the decoy
    values instead of (or in addition to) the canonical ones."""
    state_mod.save_state({"run_id": run_id, "current_phase": phase})
    Path(".datum/state.json").write_text(
        json.dumps({"run_id": _DECOY_RUN_ID, "current_phase": _DECOY_PHASE})
    )


def test_report_bug_enrichment_never_surfaces_decoy_state_json_values(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    _seed_real_state_and_poison_json_cache(tmp_path, "epic-real-42", "act")

    body = _build_body("datum.integration", RuntimeError("boom"), None)

    # The canonical (state.db) values must appear...
    assert "epic-real-42" in body
    assert "act" in body
    # ...and the decoy JSON-cache values must never leak into the report,
    # proving report_bug.py never performs a live literal read of
    # .datum/state.json.
    assert _DECOY_RUN_ID not in body
    assert _DECOY_PHASE not in body


def test_archive_main_never_derives_run_id_from_decoy_state_json(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _seed_real_state_and_poison_json_cache(tmp_path, "epic-real-99", "review")

    # Give archive.py something concrete to archive so a run directory is
    # actually created (main() short-circuits to "Nothing to archive" with
    # no paths at all).
    Path("SPEC.md").write_text("spec contents")
    monkeypatch.setitem(archive_mod.PHASE_ARTIFACTS, "refine", ["SPEC.md"])
    monkeypatch.setattr(sys, "argv", ["archive.py", "--phase", "refine"])

    archive_mod.main()

    # archive.py must have resolved run_id via datum.state.load_state()
    # (state.db), not by reading the poisoned .datum/state.json literal.
    assert Path(".datum/runs/epic-real-99/SPEC.md").exists()
    assert not Path(f".datum/runs/{_DECOY_RUN_ID}").exists()
