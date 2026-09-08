"""Tests for task-007: plan gate identifies integration lanes by `kind`,
not by a `task-INT-` id prefix.

Today `gate_plan()` computes `int_lane_ids` (and the dependency-direction
check, and the task-lane count used by `plan_not_sliced`) via
`lid.startswith(_INT_LANE_PREFIX)`. That means:

  * AC1 — a lane with a short-prefix id like 'DAT-150' and kind
    'integration' is invisible to every integration-lane rule (it should
    be treated exactly like a 'task-INT-1' lane).
  * AC2 — a legacy 'task-INT-1' lane (kind 'integration') must keep
    behaving byte-identically once the gate switches to checking `kind`.
  * AC3 — a task lane whose id happens to start with 'task-INT' but whose
    kind is 'behavioral' must NOT be treated as an integration lane
    (kind is the sole discriminator) — today it wrongly trips the
    dependency-direction check by id-shape alone.
  * AC4 — no `startswith(_INT_LANE_PREFIX)` call may remain in
    datum/gate.py.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from datum import gate


def _lane(
    lid,
    files,
    *,
    depends_on=None,
    acceptance_criteria=None,
    red_note="do the red thing",
    stage="behavioral",
    kind=None,
    title=None,
):
    lane = {
        "id": lid,
        "title": title or f"Lane {lid}",
        "files": files,
        "acceptance_criteria": (
            acceptance_criteria if acceptance_criteria is not None else ["it works"]
        ),
        "red_note": red_note,
        "stage": stage,
    }
    if depends_on is not None:
        lane["depends_on"] = depends_on
    if kind is not None:
        lane["kind"] = kind
    return lane


def _plan(lanes, *, topological_order=None, units=None, file_ownership=None):
    lane_ids = list(lanes)
    plan = {
        "schema_version": "1.0",
        "total_lanes": len(lanes),
        "topological_order": (
            topological_order if topological_order is not None else lane_ids
        ),
        "file_ownership": file_ownership if file_ownership is not None else {},
        "lanes": lanes,
    }
    if units is not None:
        plan["units"] = units
    return plan


def _invariant_table(rows: list[tuple[str, str, str, str]]) -> str:
    lines = [
        "## Integration Invariants",
        "",
        "| ID | Invariant | Covers | Source |",
        "| --- | --- | --- | --- |",
    ]
    for rid, invariant, covers, source in rows:
        lines.append(f"| {rid} | {invariant} | {covers} | {source} |")
    return "\n".join(lines) + "\n"


def _write_artifacts(
    tmp_path,
    lane_plan=None,
    tasks_md="# Tasks\n",
    tasks_json=None,
    properties_md=None,
):
    (tmp_path / "TASKS.md").write_text(tasks_md)
    if lane_plan is not None:
        (tmp_path / "lane-plan.json").write_text(json.dumps(lane_plan))
    if tasks_json is not None:
        (tmp_path / "tasks.json").write_text(json.dumps(tasks_json))
    if properties_md is not None:
        (tmp_path / "PROPERTIES.md").write_text(properties_md)


def _fail_json(capsys):
    return json.loads(capsys.readouterr().out)


@pytest.fixture
def kind_epic_dir(tmp_path, monkeypatch):
    """Isolate gate_plan's artifact resolution to tmp_path, bypassing git."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(gate, "resolve_epic_dir", lambda: tmp_path / "no-such-epic-dir")
    return tmp_path


# ── AC1: 'DAT-150' with kind 'integration' is recognised as an int lane ──


def test_ac1_short_prefix_id_with_integration_kind_is_treated_as_int_lane(
    kind_epic_dir, capsys
):
    """DAT-150 (kind=integration, depends_on DAT-149) has no Integration
    Invariants row behind it in PROPERTIES.md. If the gate recognised it
    as an integration lane (as it must, per AC1) this is an orphaned int
    lane and gate_plan fails with `int_lane_without_invariant: DAT-150`.
    Today the gate only recognises `task-INT-*` ids, so this lane is
    invisible to that check and the gate passes instead."""
    lanes = {
        "DAT-149": _lane("DAT-149", ["a.py"]),
        "DAT-150": _lane(
            "DAT-150",
            ["tests/integration/test_dat_150.py"],
            depends_on=["DAT-149"],
            kind="integration",
        ),
    }
    _write_artifacts(
        kind_epic_dir,
        _plan(lanes),
        tasks_json=[{"id": "DAT-149"}],
        properties_md="# Properties\n\nNo integration table here.\n",
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert "int_lane_without_invariant: DAT-150" in message


# ── AC2: legacy 'task-INT-1' behaves byte-identically to the new form ────


@pytest.mark.parametrize("int_lane_id", ["task-INT-1", "DAT-150"])
def test_ac2_legacy_and_short_prefix_int_lane_ids_produce_identical_messages(
    kind_epic_dir, capsys, int_lane_id
):
    """Same scenario, only the integration lane's id differs: a legacy
    'task-INT-1' id and a short-prefix 'DAT-150' id, both kind
    'integration', both orphaned (no invariant row). Gate behaviour must
    be byte-identical modulo the id substitution. Today 'task-INT-1'
    fails with the expected message but 'DAT-150' does not (it isn't
    recognised as an integration lane at all), so this parametrized test
    fails on the DAT-150 case."""
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
        int_lane_id: _lane(
            int_lane_id,
            ["tests/integration/test_int.py"],
            depends_on=["task-001"],
            kind="integration",
        ),
    }
    _write_artifacts(
        kind_epic_dir,
        _plan(lanes),
        tasks_json=[{"id": "task-001"}],
        properties_md="# Properties\n\nNo integration table here.\n",
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert (
        f"int_lane_without_invariant: {int_lane_id} has no Integration "
        "Invariants row in PROPERTIES.md" == message
    )


# ── AC3: 'task-INT'-shaped id with kind 'behavioral' is NOT an int lane ──


def test_ac3_task_int_shaped_id_with_behavioral_kind_is_not_an_int_lane(
    kind_epic_dir, capsys
):
    """'task-INT-5' looks like a legacy integration-lane id by shape, but
    its kind is 'behavioral' — an ordinary task lane. A downstream lane
    depending on it must NOT trip the integration-lane dependency-
    direction check; kind is the sole discriminator. Today the direction
    check flags any dependency whose id merely starts with 'task-INT-',
    regardless of kind, so this incorrectly fails."""
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
        "task-INT-5": _lane(
            "task-INT-5",
            ["b.py"],
            depends_on=["task-001"],
            kind="behavioral",
        ),
        "task-002": _lane(
            "task-002",
            ["c.py"],
            depends_on=["task-INT-5"],
            kind="behavioral",
        ),
    }
    _write_artifacts(
        kind_epic_dir,
        _plan(lanes),
        tasks_json=[{"id": "task-001"}],
        properties_md=_invariant_table([]),
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Plan gate passed"}


# ── AC4: no id-prefix `startswith` check remains in gate.py ─────────────


def test_ac4_no_startswith_int_lane_prefix_call_remains_in_gate_py():
    """Every `lid.startswith(_INT_LANE_PREFIX)` / `dep.startswith(_INT_LANE_PREFIX)`
    call must be gone from datum/gate.py once integration-lane detection
    is driven by `kind` instead of id shape."""
    gate_py_path = Path(gate.__file__)
    text = gate_py_path.read_text()

    assert "startswith(_INT_LANE_PREFIX)" not in text
