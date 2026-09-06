"""Tests for gate_plan()'s INT-lane validation (task-006).

Covers three new gate_plan() responsibilities layered on top of the
existing lane-plan.json checks:

  * AC3.4 — every `Covers` entry in PROPERTIES.md's Integration Invariants
    table must name a task id that actually exists in tasks.json. Each
    offending entry produces its own `invariant_covers_unknown_task: <ID>
    -> <task>` failure message.
  * AC9.1 — a `task-INT-<n>` lane's `depends_on` set must equal exactly the
    union of the `Covers` ids of the invariants it groups.
  * AC9.2 — dependency direction is one-way: a non-INT-kind lane (kind
    absent, 'task', 'behavioral', or 'structural') must never list a
    `task-INT-*` id in its own `depends_on`.
  * AC8.2 — when there are zero `task-INT-*` lanes AND PROPERTIES.md's
    invariant table is empty, gate_plan warns `no_integration_invariants`
    to stderr and exits 0 (this is a warning, not a failure).

This lane does NOT assert on `invariant_missing_for_question` (owned by
task-002's gate_properties tests).
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


@pytest.fixture
def epic_dir(tmp_path, monkeypatch):
    """Isolate gate_plan's artifact resolution to tmp_path, bypassing git."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(gate, "resolve_epic_dir", lambda: tmp_path / "no-such-epic-dir")
    return tmp_path


def _invariant_table(rows: list[tuple[str, str, str, str]]) -> str:
    """rows: (id, invariant, covers, source)"""
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


# ── AC3.4: invariant_covers_unknown_task ────────────────────────────────


def test_invariant_covers_unknown_task_fails_for_single_offender(epic_dir, capsys):
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}]
    properties_md = _invariant_table(
        [("INV-1", "some invariant", "task-999", "spec:foo")]
    )
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert (
        "invariant_covers_unknown_task: INV-1 -> task-999"
        in _fail_json(capsys)["message"]
    )


def test_invariant_covers_unknown_task_reports_one_message_per_offender(
    epic_dir, capsys
):
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}]
    properties_md = _invariant_table(
        [
            ("INV-1", "some invariant", "task-999, task-998", "spec:foo"),
        ]
    )
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert "invariant_covers_unknown_task: INV-1 -> task-999" in message
    assert "invariant_covers_unknown_task: INV-1 -> task-998" in message


# ── AC9.1: INT lane depends_on must equal union of Covers ───────────────


def test_int_lane_depends_on_not_matching_covers_union_fails(epic_dir, capsys):
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
        "task-002": _lane("task-002", ["b.py"]),
        "task-INT-1": _lane(
            "task-INT-1",
            ["tests/integration/test_int_1.py"],
            depends_on=["task-001"],
            kind="integration",
        ),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}, {"id": "task-002"}]
    properties_md = _invariant_table(
        [("INV-1", "cross-task invariant", "task-001, task-002", "spec:foo")]
    )
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert "task-INT-1" in message
    assert "task-002" in message  # covers id missing from depends_on


# ── AC9.2: dependency direction — non-INT lanes cannot depend on INT lanes ──


def test_non_int_lane_depending_on_int_lane_fails(epic_dir, capsys):
    """Lane with an explicit non-integration `kind` must be rejected for
    depending on a task-INT-* lane."""
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
        "task-INT-1": _lane(
            "task-INT-1",
            ["tests/integration/test_int_1.py"],
            depends_on=["task-001"],
            kind="integration",
        ),
        "task-002": _lane(
            "task-002",
            ["b.py"],
            depends_on=["task-INT-1"],
            kind="behavioral",
        ),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}, {"id": "task-002"}]
    properties_md = _invariant_table(
        [("INV-1", "cross-task invariant", "task-001", "spec:foo")]
    )
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert "task-002" in message
    assert "task-INT-1" in message


def test_non_int_lane_with_default_kind_depending_on_int_lane_fails(epic_dir, capsys):
    """Lane with no explicit `kind` field defaults to a non-integration kind
    and must still be rejected for depending on a task-INT-* lane."""
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
        "task-INT-1": _lane(
            "task-INT-1",
            ["tests/integration/test_int_1.py"],
            depends_on=["task-001"],
            kind="integration",
        ),
        "task-002": _lane(
            "task-002",
            ["b.py"],
            depends_on=["task-INT-1"],
        ),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}, {"id": "task-002"}]
    properties_md = _invariant_table(
        [("INV-1", "cross-task invariant", "task-001", "spec:foo")]
    )
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    result = _fail_json(capsys)
    assert result["passed"] is False
    assert "task-002" in result["message"]
    assert "task-INT-1" in result["message"]


# ── AC8.2: no_integration_invariants warning, exit 0 ─────────────────────


def test_no_integration_invariants_warns_and_exits_zero(epic_dir, capsys):
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}]
    properties_md = "## Integration Invariants\n\n| ID | Invariant | Covers | Source |\n| --- | --- | --- | --- |\n"
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    captured = capsys.readouterr()
    assert exc.value.code == 0
    assert "no_integration_invariants" in captured.err
    assert json.loads(captured.out) == {"passed": True, "message": "Plan gate passed"}


def test_no_integration_invariants_does_not_fire_when_int_lanes_present(
    epic_dir, capsys
):
    """Sanity/negative control for AC8.2: the warning must NOT fire (and the
    gate must still pass) when task-INT-* lanes exist even though the
    invariant table technically parses to rows that back them."""
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
        "task-INT-1": _lane(
            "task-INT-1",
            ["tests/integration/test_int_1.py"],
            depends_on=["task-001"],
            kind="integration",
        ),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}]
    properties_md = _invariant_table(
        [("INV-1", "cross-task invariant", "task-001", "spec:foo")]
    )
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    captured = capsys.readouterr()
    assert exc.value.code == 0
    assert "no_integration_invariants" not in captured.err
    assert json.loads(captured.out) == {"passed": True, "message": "Plan gate passed"}


# ── check_zero_lanes hard failure is unchanged ───────────────────────────


def test_check_zero_lanes_still_hard_fails_when_all_lanes_empty(epic_dir, capsys):
    plan = _plan({}, topological_order=["task-999"])
    plan["total_lanes"] = 1
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys)["message"] == "lane-plan.json has zero lanes"


# ── existing behaviors identical for a plan with no INT lanes ───────────


def test_existing_file_overlap_check_still_fails_identically_with_no_int_lanes(
    epic_dir, capsys
):
    lanes = {
        "task-001": _lane("task-001", ["shared.py"]),
        "task-002": _lane("task-002", ["shared.py"]),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}, {"id": "task-002"}]
    _write_artifacts(epic_dir, plan, tasks_json=tasks_json)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys)["message"] == (
        "File overlap shared.py across parallel tasks task-001 and task-002 "
        "(no dependency edge)"
    )


def test_existing_happy_path_still_passes_identically_with_no_int_lanes(
    epic_dir, capsys
):
    plan = _plan({"task-001": _lane("task-001", ["a.py"])})
    tasks_json = [{"id": "task-001"}]
    _write_artifacts(epic_dir, plan, tasks_json=tasks_json)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Plan gate passed"}


# ── gate-performance NFR: tasks.json / PROPERTIES.md parsed once ────────


def test_tasks_json_and_properties_md_each_read_exactly_once(epic_dir, capsys):
    lanes = {
        "task-001": _lane("task-001", ["a.py"]),
        "task-002": _lane("task-002", ["b.py"]),
        "task-INT-1": _lane(
            "task-INT-1",
            ["tests/integration/test_int_1.py"],
            depends_on=["task-001", "task-002"],
            kind="integration",
        ),
    }
    plan = _plan(lanes)
    tasks_json = [{"id": "task-001"}, {"id": "task-002"}]
    properties_md = _invariant_table(
        [("INV-1", "cross-task invariant", "task-001, task-002", "spec:foo")]
    )
    _write_artifacts(
        epic_dir,
        plan,
        tasks_json=tasks_json,
        properties_md=properties_md,
    )

    read_counts = {"tasks.json": 0, "PROPERTIES.md": 0}
    original_read_text = Path.read_text
    original_open = Path.open

    def counting_read_text(self, *args, **kwargs):
        if self.name in read_counts:
            read_counts[self.name] += 1
        return original_read_text(self, *args, **kwargs)

    def counting_open(self, *args, **kwargs):
        if self.name in read_counts:
            read_counts[self.name] += 1
        return original_open(self, *args, **kwargs)

    import unittest.mock as mock

    with (
        mock.patch.object(Path, "read_text", counting_read_text),
        mock.patch.object(Path, "open", counting_open),
    ):
        with pytest.raises(SystemExit) as exc:
            gate.gate_plan(True, {})

    assert exc.value.code == 0
    assert read_counts["tasks.json"] == 1
    assert read_counts["PROPERTIES.md"] == 1
