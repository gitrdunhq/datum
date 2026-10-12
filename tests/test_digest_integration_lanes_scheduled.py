"""Act start refuses a plan that dropped PROPERTIES.md's integration lanes.

datum self-hosted run 20261012: the Properties gate failed inside the
workflow, so the step that schedules integration lanes (lane-plan
--properties, then the plan gate) never ran. The halt said "fix, then
datum go --start-from act"; Act ran the 20-lane plan and the 19 invariant
lanes PROPERTIES.md asked for were never built, with nothing saying so.
`datum lane-plan-digest`, which every Act start runs, now fails closed
naming the unscheduled invariants and the command that schedules them.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.lane_plan_digest import DigestError, digest_plan_file

PROPERTIES = """# Properties

## Integration Invariants

| ID | Invariant | Covers | Source |
|---|---|---|---|
| INT-01 | a and b agree | DAT-1, DAT-2 | spec:R1 |
| INT-02 | b and c agree | DAT-2, DAT-3 | spec:R2 |
"""


def _lane(lid: str, **extra) -> dict:
    return {
        "id": lid,
        "files": [f"{lid}.py"],
        "acceptance_criteria": ["a"],
        "red_note": "r",
        "depends_on": [],
        **extra,
    }


def _plan(*int_lanes: dict) -> dict:
    lanes = {lid: _lane(lid) for lid in ("DAT-1", "DAT-2", "DAT-3")}
    for lane in int_lanes:
        lanes[lane["id"]] = lane
    return {
        "schema_version": "1.0.0",
        "total_lanes": len(lanes),
        "topological_order": list(lanes),
        "file_ownership": {},
        "lanes": lanes,
    }


def _int(lid: str, invariants: list[str]) -> dict:
    return _lane(lid, kind="integration", expect_tests_pass=True, invariants=invariants)


def _epic(tmp_path: Path, plan: dict, properties: str | None = PROPERTIES) -> Path:
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    epic = tmp_path / "docs" / "epics" / "e"
    epic.mkdir(parents=True)
    (epic / "lane-plan.json").write_text(json.dumps(plan))
    if properties is not None:
        (epic / "PROPERTIES.md").write_text(properties)
    return epic / "lane-plan.json"


def test_a_plan_without_the_integration_lanes_is_refused_by_name(tmp_path):
    # Catches: Act running a plan that silently dropped every invariant lane.
    plan = _epic(tmp_path, _plan())
    with pytest.raises(DigestError) as info:
        digest_plan_file(plan)
    msg = str(info.value)
    assert msg.startswith("integration_lanes_unscheduled:")
    assert "INT-01" in msg and "INT-02" in msg
    assert "--properties" in msg and "PROPERTIES.md" in msg


def test_a_plan_missing_one_invariant_names_only_that_one(tmp_path):
    plan = _epic(tmp_path, _plan(_int("DAT-4", ["INT-01"])))
    with pytest.raises(DigestError) as info:
        digest_plan_file(plan)
    assert "INT-02" in str(info.value)
    assert "INT-01" not in str(info.value).split(":", 1)[1].split("—")[0]


def test_a_plan_carrying_every_invariant_digests(tmp_path):
    plan = _epic(tmp_path, _plan(_int("DAT-4", ["INT-01"]), _int("DAT-5", ["INT-02"])))
    digest = json.loads(digest_plan_file(plan))
    assert digest["total_lanes"] == 5


def test_no_properties_file_or_no_invariant_table_is_not_checked(tmp_path):
    # Catches: refusing epics that never had integration invariants.
    plan = _epic(tmp_path, _plan(), properties=None)
    assert json.loads(digest_plan_file(plan))["total_lanes"] == 3
    (plan.parent / "PROPERTIES.md").write_text("# Properties\n\nNo table here.\n")
    assert json.loads(digest_plan_file(plan))["total_lanes"] == 3


def test_the_cli_prints_the_named_error_and_exits_1(tmp_path, monkeypatch):
    from datum.cli import app

    plan = _epic(tmp_path, _plan())
    monkeypatch.chdir(tmp_path)
    r = CliRunner().invoke(app, ["lane-plan-digest", "--plan", str(plan)])
    assert r.exit_code == 1
    assert json.loads(r.output)["error"].startswith("integration_lanes_unscheduled:")
