"""task-001 AC5: the lane-spec file written by `datum/lane_spec_export.py`
for an integration lane must parse as JSON containing
`expect_tests_pass: true` and `depends_on` equal to the lane's covered
task ids, in lane order.

Per the lane spec's red_note: this is a pure assertion against the
ALREADY-WORKING `**lane` spread in `datum/lane_spec_export.py` — this
module is read-only here, never modified by this lane. This test may pass
on first run; that is expected and is the regression pin AC4.3 (widely,
AC5 in this lane's own numbering) asks for — it protects the passthrough
from being broken by whatever change makes AC1-AC4 pass in
`datum/lane_plan_digest.py`.
"""

from __future__ import annotations

import json
from pathlib import Path

from datum.lane_spec_export import export_lane_spec


def test_ac5_exported_integration_lane_spec_has_expect_tests_pass_and_depends_on(
    tmp_path: Path,
):
    lane = {
        "title": "An integration lane",
        "files": ["src/a.py"],
        "acceptance_criteria": ["frobnicate(x) returns 1"],
        "kind": "integration",
        "expect_tests_pass": True,
        "depends_on": ["task-002", "task-003"],
    }
    plan = {"lanes": {"task-001": lane}}
    out = tmp_path / "lane-spec.json"

    export_lane_spec(plan, "task-001", out, expect_hash=None)

    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["expect_tests_pass"] is True
    assert written["depends_on"] == ["task-002", "task-003"]
