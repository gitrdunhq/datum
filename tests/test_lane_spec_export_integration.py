"""task-007: an exported INT (integration) lane spec must carry the
tests-must-pass note as the leading `contract_summary` entry, and
`expect_tests_pass` must survive the `**lane` spread untouched.

Per the lane spec's red_note: `contract_summary()` returns `list[dict]`,
not a string. The "includes a sentence" requirement from the epic is
realized as a leading `{'note': ...}` dict entry — pinned verbatim below —
injected by `export_lane_spec` for `kind == 'integration'` lanes only.
`contract_summary()` itself must never change: its note-free output for
any given criteria list is unchanged (AC5.2), and non-integration lanes
must see byte-identical export output with no note and no
`expect_tests_pass` key (AC5.3, AC4.3).

Hand-written in-memory plan dicts only — no dependency on build_lane_plan
(see red_note). Must NOT reuse tests/test_lane_spec_export.py.
"""

from __future__ import annotations

import json
from pathlib import Path

from datum.lane_spec_export import contract_summary, export_lane_spec

# Pinned verbatim from the lane spec (AC5.1/AC5.2) — GREEN must reproduce
# this exact dict, and this test file may not be edited by GREEN, so any
# drift here permanently deadlocks the lane.
INTEGRATION_NOTE = {
    "note": (
        "This is an integration lane: its tests are expected to PASS "
        "against the already-merged code and must not be written to fail."
    )
}

_CRITERIA = [
    "frobnicate(x, y) returns 1",
    "risky(bad) raises ValueError",
]


def _integration_lane(**extra: object) -> dict:
    lane = {
        "title": "An integration lane",
        "files": ["src/a.py"],
        "acceptance_criteria": list(_CRITERIA),
        "kind": "integration",
    }
    lane.update(extra)
    return lane


def test_integration_lane_contract_summary_leads_with_the_note_dict(tmp_path: Path):
    """AC5.1/AC5.2: contract_summary[0] is the note dict verbatim, and the
    rest of the list is untouched relative to a direct contract_summary()
    call."""
    lane = _integration_lane()
    plan = {"lanes": {"task-x": lane}}
    out = tmp_path / "lane-spec.json"

    export_lane_spec(plan, "task-x", out, expect_hash=None)
    written = json.loads(out.read_text(encoding="utf-8"))

    assert written["contract_summary"][0] == INTEGRATION_NOTE
    assert written["contract_summary"][1:] == contract_summary(_CRITERIA)


def test_note_comes_from_export_not_from_contract_summary_itself(tmp_path: Path):
    """AC5.2: contract_summary() never injects the note — export_lane_spec
    does. The exported list must equal [NOTE] + the direct call's result,
    proving contract_summary()'s own signature/return value is unchanged."""
    lane = _integration_lane()
    plan = {"lanes": {"task-x": lane}}
    out = tmp_path / "lane-spec.json"

    export_lane_spec(plan, "task-x", out, expect_hash=None)
    written = json.loads(out.read_text(encoding="utf-8"))

    direct = contract_summary(_CRITERIA)
    assert len(direct) == 2, "fixture must produce a discriminating comparison"
    assert written["contract_summary"] == [INTEGRATION_NOTE] + direct


def test_non_integration_kind_exports_contract_summary_with_no_note(tmp_path: Path):
    """AC5.3: for kind absent / 'task' / 'behavioral' / 'structural', the
    exported contract_summary is byte-identical to the current pre-slice
    output (i.e. exactly contract_summary(criteria), no note prepended)."""
    for kind in (None, "task", "behavioral", "structural"):
        lane = {
            "title": "A non-integration lane",
            "files": ["src/b.py"],
            "acceptance_criteria": list(_CRITERIA),
        }
        if kind is not None:
            lane["kind"] = kind
        plan = {"lanes": {"task-y": lane}}
        out = tmp_path / f"lane-spec-{kind}.json"

        export_lane_spec(plan, "task-y", out, expect_hash=None)
        written = json.loads(out.read_text(encoding="utf-8"))

        assert written["contract_summary"] == contract_summary(_CRITERIA)
        assert INTEGRATION_NOTE not in written["contract_summary"]


def test_integration_lane_expect_tests_pass_survives_the_lane_spread(tmp_path: Path):
    """AC4.2: expect_tests_pass: true on the input lane dict must survive
    to the exported body via the existing **lane spread, with no extra
    export code deriving it from kind."""
    lane = _integration_lane(expect_tests_pass=True)
    plan = {"lanes": {"task-x": lane}}
    out = tmp_path / "lane-spec.json"

    export_lane_spec(plan, "task-x", out, expect_hash=None)
    written = json.loads(out.read_text(encoding="utf-8"))

    assert written["expect_tests_pass"] is True


def test_task_lane_export_has_no_expect_tests_pass_key(tmp_path: Path):
    """AC4.3: a task lane that never set expect_tests_pass must not gain
    the key in the exported body."""
    lane = {
        "title": "A task lane",
        "files": ["src/c.py"],
        "acceptance_criteria": list(_CRITERIA),
        "kind": "task",
    }
    plan = {"lanes": {"task-z": lane}}
    out = tmp_path / "lane-spec.json"

    export_lane_spec(plan, "task-z", out, expect_hash=None)
    written = json.loads(out.read_text(encoding="utf-8"))

    assert "expect_tests_pass" not in written


def test_ac_count_for_integration_lane_equals_criteria_length_not_summary_length(
    tmp_path: Path,
):
    """AC7.1: ac_count in the returned summary equals
    len(lane['acceptance_criteria']) — the invariant count — even though
    the exported contract_summary list is one entry longer (leading
    note) for integration lanes."""
    lane = _integration_lane()
    plan = {"lanes": {"task-x": lane}}
    out = tmp_path / "lane-spec.json"

    summary = export_lane_spec(plan, "task-x", out, expect_hash=None)

    assert summary["ac_count"] == len(_CRITERIA) == 2
    written = json.loads(out.read_text(encoding="utf-8"))
    assert len(written["contract_summary"]) == len(_CRITERIA) + 1
