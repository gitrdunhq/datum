"""Characterization tests for gate_plan() in datum/gate.py.

gate_plan is the gate every pipeline run passes between Plan and Act. It
checks TASKS.md / lane-plan.json existence, schema validation, zero-lane
rejection, topological_order vs lanes, per-lane required fields
(files, red_note, acceptance_criteria), unknown depends_on, units, and a
transitive file-overlap check via the task dependency closure.
"""

import json

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


def _write_artifacts(tmp_path, lane_plan=None, tasks_md="# Tasks\n"):
    (tmp_path / "TASKS.md").write_text(tasks_md)
    if lane_plan is not None:
        (tmp_path / "lane-plan.json").write_text(json.dumps(lane_plan))


def _fail_json(capsys):
    return json.loads(capsys.readouterr().out)


# ── existence checks ─────────────────────────────────────────────────────


def test_missing_tasks_md_fails(epic_dir, capsys):
    (epic_dir / "lane-plan.json").write_text(
        json.dumps(_plan({"task-001": _lane("task-001", ["a.py"])}))
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys) == {
        "passed": False,
        "hard_stop": False,
        "message": "TASKS.md not found",
    }


def test_missing_lane_plan_fails(epic_dir, capsys):
    _write_artifacts(epic_dir)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys) == {
        "passed": False,
        "hard_stop": False,
        "message": "Missing lane-plan.json. Run datum lane-plan first.",
    }


# ── schema validation ────────────────────────────────────────────────────


def test_schema_validation_failure_is_hard_stop(epic_dir, capsys):
    bad_plan = _plan({"task-001": _lane("task-001", ["a.py"])})
    del bad_plan["schema_version"]  # required field
    _write_artifacts(epic_dir, bad_plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 2
    result = _fail_json(capsys)
    assert result["passed"] is False
    assert result["hard_stop"] is True
    assert result["message"].startswith("lane-plan.json schema validation failed:")


# ── zero lanes ────────────────────────────────────────────────────────────


def test_zero_lanes_fails(epic_dir, capsys):
    plan = _plan({}, topological_order=["task-999"])
    plan["total_lanes"] = 1
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys)["message"] == "lane-plan.json has zero lanes"


# ── topological_order vs lanes ──────────────────────────────────────────


def test_topological_order_missing_lane_fails(epic_dir, capsys):
    plan = _plan(
        {"task-001": _lane("task-001", ["a.py"])},
        topological_order=["task-002"],
    )
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert (
        _fail_json(capsys)["message"]
        == "lane-plan.json topological_order does not match lanes"
    )


def test_topological_order_duplicate_entries_rejected(epic_dir, capsys):
    """BUG (fixed in gate.py): set(topological_order) != lane_ids hid
    duplicate entries. ["task-001", "task-001"] has the same *set* as
    {"task-001"}, so the original comparison let a malformed
    topological_order (a lane repeated instead of every lane listed once)
    sail through and the plan gate would pass. gate_plan must also compare
    lengths, not just set membership.
    """
    plan = _plan(
        {"task-001": _lane("task-001", ["a.py"])},
        topological_order=["task-001", "task-001"],
        file_ownership={"a.py": "task-001"},
    )
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert (
        _fail_json(capsys)["message"]
        == "lane-plan.json topological_order does not match lanes"
    )


# ── per-lane required fields (schema check stubbed to isolate the branch) ──


@pytest.fixture
def no_schema_check(monkeypatch):
    """Stub out contract schema validation so gate_plan's own per-lane
    defense-in-depth checks (files/red_note/acceptance_criteria) can be
    exercised directly. The Pydantic lane-plan schema already requires
    these fields, so in a real run these branches are unreachable via a
    schema-valid payload; this isolates them as characterization tests of
    gate_plan's own logic regardless of the schema layer.
    """
    monkeypatch.setattr(
        gate, "_contracts", lambda: (lambda *a, **k: [], lambda *a, **k: [])
    )


def test_lane_missing_files_field_fails(epic_dir, no_schema_check, capsys):
    lane = _lane("task-001", ["a.py"])
    del lane["files"]
    plan = _plan({"task-001": lane})
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert (
        _fail_json(capsys)["message"]
        == "Lane task-001 missing 'files' field in lane-plan.json"
    )


def test_lane_missing_red_note_fails(epic_dir, no_schema_check, capsys):
    lane = _lane("task-001", ["a.py"])
    del lane["red_note"]
    plan = _plan({"task-001": lane})
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert (
        _fail_json(capsys)["message"]
        == "Lane task-001 missing 'red_note' in lane-plan.json"
    )


def test_lane_empty_acceptance_criteria_fails(epic_dir, no_schema_check, capsys):
    lane = _lane("task-001", ["a.py"], acceptance_criteria=[])
    plan = _plan({"task-001": lane})
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys)["message"] == "Lane task-001 missing acceptance_criteria"


# ── unknown depends_on ────────────────────────────────────────────────────


def test_lane_depends_on_unknown_lane_fails(epic_dir, capsys):
    plan = _plan({"task-001": _lane("task-001", ["a.py"], depends_on=["task-099"])})
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert (
        _fail_json(capsys)["message"]
        == "Lane task-001 depends on unknown lane task-099"
    )


# ── units must be objects (BUG, fixed: crashed instead of failing gate) ──


def test_unit_entry_must_be_an_object(epic_dir, capsys):
    """BUG (fixed in gate.py): lane-plan.schema.json types `units` values as
    `Any`, so a malformed unit entry (a plain string instead of an object)
    passes schema validation. gate_plan's unit-dependency resolution then
    called `.get()` on it directly and crashed with AttributeError instead
    of failing the gate cleanly.
    """
    plan = _plan(
        {"task-001": _lane("task-001", ["a.py"])},
        units={"unit-1": "not-an-object"},
    )
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert "unit-1" in _fail_json(capsys)["message"]


# ── transitive file-overlap check ────────────────────────────────────────


def test_transitive_dependency_chain_permits_shared_file(epic_dir, capsys):
    """task-001 -> task-002 -> task-003: task-001 and task-003 share a file
    via a transitive (not direct) dependency edge. Must not be flagged.
    """
    lanes = {
        "task-001": _lane("task-001", ["shared.py"]),
        "task-002": _lane("task-002", ["b.py"], depends_on=["task-001"]),
        "task-003": _lane("task-003", ["shared.py"], depends_on=["task-002"]),
    }
    plan = _plan(lanes, topological_order=["task-001", "task-002", "task-003"])
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Plan gate passed"}


def test_independent_lanes_sharing_file_without_dependency_fails(epic_dir, capsys):
    lanes = {
        "task-001": _lane("task-001", ["shared.py"]),
        "task-002": _lane("task-002", ["shared.py"]),
    }
    plan = _plan(lanes)
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys)["message"] == (
        "File overlap shared.py across parallel tasks task-001 and task-002 "
        "(no dependency edge)"
    )


# ── ADR sequence numbers (#372) ──────────────────────────────────────────
# Two independent lanes each created a new ADR under docs/adr/ and both chose
# 012, so the second lane's GREEN hit file_ownership_violation. The paths
# differ, so the file-overlap rule above never sees it — the collision is in
# the sequence number, not the path.


def test_adr_sequence_collision_across_lanes_fails(epic_dir, capsys):
    lanes = {
        "task-003": _lane("task-003", ["docs/adr/012-cache-keys.md", "src/a.py"]),
        "task-007": _lane("task-007", ["docs/adr/012-lane-ids.md", "src/b.py"]),
    }
    _write_artifacts(epic_dir, _plan(lanes))

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys)["message"] == (
        "plan_adr_sequence_collision: docs/adr/012-*.md claimed by task-003 and task-007"
    )


def test_adr_sequence_collision_fails_even_with_a_dependency_edge(epic_dir, capsys):
    """A dependency edge sequences the lanes but does not renumber the ADR:
    both still write a docs/adr/012-*.md and the second one is wrong."""
    lanes = {
        "task-001": _lane("task-001", ["docs/adr/012-a.md"]),
        "task-002": _lane("task-002", ["docs/adr/012-b.md"], depends_on=["task-001"]),
    }
    _write_artifacts(epic_dir, _plan(lanes))

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert "plan_adr_sequence_collision" in _fail_json(capsys)["message"]


def test_distinct_adr_sequence_numbers_pass(epic_dir, capsys):
    lanes = {
        "task-003": _lane("task-003", ["docs/adr/012-cache-keys.md", "src/a.py"]),
        "task-007": _lane("task-007", ["docs/adr/013-lane-ids.md", "src/b.py"]),
    }
    _write_artifacts(epic_dir, _plan(lanes))

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Plan gate passed"}


def test_one_lane_owning_two_adrs_is_not_a_collision(epic_dir, capsys):
    lanes = {
        "task-001": _lane("task-001", ["docs/adr/012-a.md", "docs/adr/012-b.md"]),
        "task-002": _lane("task-002", ["src/b.py"]),
    }
    _write_artifacts(epic_dir, _plan(lanes))

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0


def test_non_adr_files_and_unnumbered_adr_paths_are_ignored(epic_dir, capsys):
    """Only docs/adr/NNN-*.md counts: an ADR README, a numbered file in some
    other directory, and a same-named file under src/adr must not collide."""
    lanes = {
        "task-001": _lane(
            "task-001", ["docs/adr/README.md", "src/adr/012-x.md", "docs/012-note.md"]
        ),
        "task-002": _lane(
            "task-002", ["docs/adr/index.md", "src/adr/012-y.md", "docs/012-memo.md"]
        ),
    }
    _write_artifacts(epic_dir, _plan(lanes))

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0


def test_identical_adr_path_is_left_to_the_file_overlap_rule(epic_dir, capsys):
    """Same path, not just same number: that is a file overlap, and reporting
    it twice would double-report one defect (and would newly fail a legitimate
    dependency-linked pair that shares one file)."""
    lanes = {
        "task-001": _lane("task-001", ["docs/adr/012-a.md"]),
        "task-002": _lane("task-002", ["docs/adr/012-a.md"]),
    }
    _write_artifacts(epic_dir, _plan(lanes))

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys)["message"].startswith("File overlap docs/adr/012-a.md")


# ── the pure helper ──────────────────────────────────────────────────────


def test_adr_sequence_collisions_helper_reports_sorted_pairs():
    lanes = {
        "task-007": {"files": ["docs/adr/012-b.md"]},
        "task-003": {"files": ["docs/adr/012-a.md"]},
    }

    assert gate.adr_sequence_collisions(lanes) == [
        "plan_adr_sequence_collision: docs/adr/012-*.md claimed by task-003 and task-007"
    ]


def test_adr_sequence_collisions_helper_is_empty_for_a_clean_plan():
    lanes = {
        "task-001": {"files": ["docs/adr/012-a.md"]},
        "task-002": {"files": ["docs/adr/013-b.md", "src/x.py"]},
        "task-003": {"files": []},
    }

    assert gate.adr_sequence_collisions(lanes) == []


# ── happy path / yolo vs human-approval ─────────────────────────────────


def test_happy_path_yolo_passes(epic_dir, capsys):
    plan = _plan({"task-001": _lane("task-001", ["a.py"])})
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Plan gate passed"}


def test_non_yolo_needs_human_approval(epic_dir, capsys):
    plan = _plan({"task-001": _lane("task-001", ["a.py"])})
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(False, {})

    assert exc.value.code == 1
    result = _fail_json(capsys)
    assert result["passed"] is False
    assert result["needs_human"] is True
    assert result["message"] == (
        "TASKS.md and lane-plan.json ready for human approval. "
        "Re-run with --approve to approve."
    )


def test_non_yolo_skips_approval_when_policy_skipped(epic_dir, capsys):
    plan = _plan({"task-001": _lane("task-001", ["a.py"])})
    _write_artifacts(epic_dir, plan)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(False, {"gates": {"plan_human_approval": "skipped"}})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Plan gate passed"}
