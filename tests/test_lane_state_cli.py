"""Tests for `datum lane-state read|write` CLI subcommand.

Acceptance criteria under test:
1. `lane-state write` creates .datum/epics/<slug>/lane-state/<task>.json with the
   expected fields (task_id, status, merge_commit, spec_hash, run_id, completed_at).
2. `lane-state read` for an existing marker prints the exact JSON that was written.
3. `lane-state read` for a nonexistent marker exits 0 and prints {"status": "not_found"}.
4. Writing the same marker twice with identical inputs produces byte-identical files.
5. `lane-state write --epic '../../etc' ...` exits non-zero, creates no directory
   outside .datum/epics/.
6. Epic branch slugification: 'datum/epic-287' -> 'datum-epic-287'.
"""

import json
import os

from typer.testing import CliRunner

from datum.cli import app


def _epic_dir(datum_root, slug):
    return datum_root / "epics" / slug


def test_lane_state_write_creates_marker_with_expected_fields(tmp_path, monkeypatch):
    """AC1: `lane-state write` creates the marker file with the correct fields."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-287",
            "--task",
            "task-002",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "h1",
            "--run-id",
            "run1",
        ],
    )

    assert result.exit_code == 0, result.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-287"
        / "lane-state"
        / "task-002.json"
    )
    assert marker_path.exists(), "expected lane-state marker file to be created"

    data = json.loads(marker_path.read_text())
    assert data["task_id"] == "task-002"
    assert data["status"] == "completed"
    assert data["merge_commit"] == "abc123"
    assert data["spec_hash"] == "h1"
    assert data["run_id"] == "run1"
    assert "completed_at" in data


def test_lane_state_read_prints_matching_json_for_existing_marker(
    tmp_path, monkeypatch
):
    """AC2: `lane-state read` prints the exact JSON that was written by `write`."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-287",
            "--task",
            "task-002",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "h1",
            "--run-id",
            "run1",
        ],
    )
    assert write_result.exit_code == 0, write_result.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-287"
        / "lane-state"
        / "task-002.json"
    )
    expected = json.loads(marker_path.read_text())

    read_result = runner.invoke(
        app,
        ["lane-state", "read", "--epic", "datum/epic-287", "--task", "task-002"],
    )

    assert read_result.exit_code == 0, read_result.output
    printed = json.loads(read_result.stdout)
    assert printed == expected


def test_lane_state_read_returns_not_found_for_missing_marker(tmp_path, monkeypatch):
    """AC3: `lane-state read` for a missing marker exits 0 and prints not_found."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        ["lane-state", "read", "--epic", "datum/epic-287", "--task", "task-999"],
    )

    assert result.exit_code == 0, result.output
    printed = json.loads(result.stdout)
    assert printed == {"status": "not_found"}


def test_lane_state_write_twice_is_byte_identical(tmp_path, monkeypatch):
    """AC4: writing the same marker twice with identical inputs is byte-identical."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    args = [
        "lane-state",
        "write",
        "--epic",
        "datum/epic-287",
        "--task",
        "task-002",
        "--status",
        "completed",
        "--merge-commit",
        "abc123",
        "--spec-hash",
        "h1",
        "--run-id",
        "run1",
        "--completed-at",
        "2026-01-01T00:00:00Z",
    ]

    runner = CliRunner()
    first = runner.invoke(app, args)
    assert first.exit_code == 0, first.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-287"
        / "lane-state"
        / "task-002.json"
    )
    first_bytes = marker_path.read_bytes()

    second = runner.invoke(app, args)
    assert second.exit_code == 0, second.output
    second_bytes = marker_path.read_bytes()

    assert first_bytes == second_bytes


def test_lane_state_write_rejects_path_traversal_epic(tmp_path, monkeypatch):
    """AC5: `--epic '../../etc'` exits non-zero and creates no directory outside epics/."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "../../etc",
            "--task",
            "x",
            "--status",
            "completed",
        ],
    )

    assert result.exit_code != 0

    # Must be a deliberate rejection of the traversal attempt, not merely the
    # "lane-state" command being unrecognized (Typer's "No such command" error
    # would also exit non-zero, which would make this test pass vacuously).
    assert "no such command" not in result.output.lower()

    # No directory named "etc" should be created anywhere outside .datum/epics/.
    outside_dir = tmp_path.parent.parent / "etc"
    assert not outside_dir.exists()

    epics_dir = tmp_path / ".datum" / "epics"
    if epics_dir.exists():
        for child in epics_dir.iterdir():
            assert ".." not in child.name


def test_lane_state_epic_branch_slugification(tmp_path, monkeypatch):
    """AC6: 'datum/epic-287' slugifies to 'datum-epic-287' as a directory name."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-287",
            "--task",
            "task-slug-check",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "h1",
            "--run-id",
            "run1",
        ],
    )
    assert result.exit_code == 0, result.output

    slug_dir = tmp_path / ".datum" / "epics" / "datum-epic-287"
    assert slug_dir.is_dir()
    assert not (tmp_path / ".datum" / "epics" / "datum" / "epic-287").exists()
    assert os.path.sep not in "datum-epic-287"


def _lane_state_dir_for(tmp_path, epic_slug):
    return tmp_path / ".datum" / "epics" / epic_slug / "lane-state"


def test_lane_state_write_rejects_path_traversal_task(tmp_path, monkeypatch):
    """Security: a `--task` with `../` segments must not write outside lane-state/."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    outside_target = tmp_path.parent / "pwned.json"
    lane_state_dir = _lane_state_dir_for(tmp_path, "datum-epic-1")
    rel = os.path.relpath(outside_target, lane_state_dir)
    traversal_task = rel[: -len(".json")] if rel.endswith(".json") else rel

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-1",
            "--task",
            traversal_task,
            "--status",
            "completed",
        ],
    )

    assert result.exit_code != 0
    assert "no such command" not in result.output.lower()
    assert not outside_target.exists()


def _write_marker(runner, **overrides):
    args = {
        "epic": "datum/epic-overwrite",
        "task": "task-001",
        "status": "completed",
        "merge_commit": "abc123",
        "spec_hash": "h1",
        "run_id": "run1",
        "completed_at": "2026-01-01T00:00:00Z",
    }
    args.update(overrides)
    force = args.pop("force", False)
    argv = ["lane-state", "write"]
    for key, value in args.items():
        if value == "" or value is None:
            continue
        argv.extend([f"--{key.replace('_', '-')}", str(value)])
    if force:
        argv.append("--force")
    return runner.invoke(app, argv)


def test_lane_state_write_refuses_to_overwrite_completed_marker(tmp_path, monkeypatch):
    """A second completed->completed write must not overwrite the marker."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    first = _write_marker(runner)
    assert first.exit_code == 0, first.output

    second = _write_marker(
        runner,
        merge_commit="different-sha",
        spec_hash="different-hash",
        run_id="run2",
        completed_at="2026-02-02T00:00:00Z",
    )
    assert second.exit_code == 0, second.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-overwrite"
        / "lane-state"
        / "task-001.json"
    )
    data = json.loads(marker_path.read_text())
    # Original fields preserved — not overwritten by the second call.
    assert data["merge_commit"] == "abc123"
    assert data["spec_hash"] == "h1"
    assert data["run_id"] == "run1"
    assert data["completed_at"] == "2026-01-01T00:00:00Z"

    printed = json.loads(second.stdout)
    assert printed["unchanged"] is True
    assert printed["merge_commit"] == "abc123"
    assert printed["spec_hash"] == "h1"


def test_lane_state_write_force_overwrites_completed_marker(tmp_path, monkeypatch):
    """--force overwrites an existing completed marker."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    first = _write_marker(runner)
    assert first.exit_code == 0, first.output

    second = _write_marker(
        runner,
        merge_commit="different-sha",
        spec_hash="different-hash",
        run_id="run2",
        completed_at="2026-02-02T00:00:00Z",
        force=True,
    )
    assert second.exit_code == 0, second.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-overwrite"
        / "lane-state"
        / "task-001.json"
    )
    data = json.loads(marker_path.read_text())
    assert data["merge_commit"] == "different-sha"
    assert data["spec_hash"] == "different-hash"
    assert data["run_id"] == "run2"
    assert data["completed_at"] == "2026-02-02T00:00:00Z"
    assert "unchanged" not in json.loads(second.stdout)


def test_lane_state_write_status_change_from_completed_still_writes(
    tmp_path, monkeypatch
):
    """completed -> failed is a status change and must write (no --force needed)."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    first = _write_marker(runner)
    assert first.exit_code == 0, first.output

    second = _write_marker(runner, status="failed", merge_commit="new-sha")
    assert second.exit_code == 0, second.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-overwrite"
        / "lane-state"
        / "task-001.json"
    )
    data = json.loads(marker_path.read_text())
    assert data["status"] == "failed"
    assert data["merge_commit"] == "new-sha"
    assert "unchanged" not in json.loads(second.stdout)


def test_lane_state_write_non_completed_to_completed_writes(tmp_path, monkeypatch):
    """A non-completed -> completed transition always writes, even without --force."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    first = _write_marker(runner, status="running")
    assert first.exit_code == 0, first.output

    second = _write_marker(runner, status="completed", merge_commit="new-sha")
    assert second.exit_code == 0, second.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-overwrite"
        / "lane-state"
        / "task-001.json"
    )
    data = json.loads(marker_path.read_text())
    assert data["status"] == "completed"
    assert data["merge_commit"] == "new-sha"
    assert "unchanged" not in json.loads(second.stdout)


def test_lane_state_read_rejects_path_traversal_task(tmp_path, monkeypatch):
    """Security: a `--task` with `../` segments must not disclose files outside lane-state/."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    secret = tmp_path.parent / "secret.json"
    secret.write_text('{"leaked": true}')

    lane_state_dir = _lane_state_dir_for(tmp_path, "datum-epic-1")
    rel = os.path.relpath(secret, lane_state_dir)
    traversal_task = rel[: -len(".json")] if rel.endswith(".json") else rel

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "read",
            "--epic",
            "datum/epic-1",
            "--task",
            traversal_task,
        ],
    )

    assert result.exit_code != 0
    assert "leaked" not in result.output


# ---------------------------------------------------------------------------
# `lane-state rehash` — recompute spec_hash from the on-disk plan
# ---------------------------------------------------------------------------


def _write_lane_plan(path, lanes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"lanes": lanes}))


def _some_lane(**overrides):
    lane = {
        "files": ["a.py"],
        "acceptance_criteria": ["does a thing"],
        "depends_on": [],
    }
    lane.update(overrides)
    return lane


def test_lane_state_rehash_prefers_lane_plan_final_json(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    _write_marker(runner, epic="datum/epic-rehash", spec_hash="stale-hash")

    epic_dir = tmp_path / "docs" / "epics" / "datum" / "epic-rehash"
    lane = _some_lane(files=["real.py"])
    _write_lane_plan(epic_dir / "lane-plan-final.json", {"task-001": lane})
    _write_lane_plan(
        epic_dir / "lane-plan.json", {"task-001": _some_lane(files=["wrong.py"])}
    )

    from datum.lane_hash import lane_spec_hash

    expected_hash = lane_spec_hash(lane)

    result = runner.invoke(
        app,
        ["lane-state", "rehash", "--epic", "datum/epic-rehash", "--task", "task-001"],
    )
    assert result.exit_code == 0, result.output

    marker = json.loads(result.stdout)
    assert marker["spec_hash"] == expected_hash
    # Untouched fields preserved from the original write.
    assert marker["merge_commit"] == "abc123"
    assert marker["run_id"] == "run1"
    assert marker["completed_at"] == "2026-01-01T00:00:00Z"


def test_lane_state_rehash_falls_back_to_lane_plan_json(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    _write_marker(runner, epic="datum/epic-rehash2", spec_hash="stale-hash")

    epic_dir = tmp_path / "docs" / "epics" / "datum" / "epic-rehash2"
    lane = _some_lane(files=["default.py"])
    _write_lane_plan(epic_dir / "lane-plan.json", {"task-001": lane})

    from datum.lane_hash import lane_spec_hash

    expected_hash = lane_spec_hash(lane)

    result = runner.invoke(
        app,
        ["lane-state", "rehash", "--epic", "datum/epic-rehash2", "--task", "task-001"],
    )
    assert result.exit_code == 0, result.output
    marker = json.loads(result.stdout)
    assert marker["spec_hash"] == expected_hash


def test_lane_state_rehash_falls_back_to_dot_datum_lane_plan(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    _write_marker(runner, epic="datum/epic-rehash3", spec_hash="stale-hash")

    lane = _some_lane(files=["fallback.py"])
    _write_lane_plan(tmp_path / ".datum" / "lane-plan.json", {"task-001": lane})

    from datum.lane_hash import lane_spec_hash

    expected_hash = lane_spec_hash(lane)

    result = runner.invoke(
        app,
        ["lane-state", "rehash", "--epic", "datum/epic-rehash3", "--task", "task-001"],
    )
    assert result.exit_code == 0, result.output
    marker = json.loads(result.stdout)
    assert marker["spec_hash"] == expected_hash


def test_lane_state_rehash_accepts_explicit_lane_plan_override(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    _write_marker(runner, epic="datum/epic-rehash4", spec_hash="stale-hash")

    lane = _some_lane(files=["explicit.py"])
    custom_plan = tmp_path / "somewhere" / "custom-plan.json"
    _write_lane_plan(custom_plan, {"task-001": lane})

    from datum.lane_hash import lane_spec_hash

    expected_hash = lane_spec_hash(lane)

    result = runner.invoke(
        app,
        [
            "lane-state",
            "rehash",
            "--epic",
            "datum/epic-rehash4",
            "--task",
            "task-001",
            "--lane-plan",
            str(custom_plan),
        ],
    )
    assert result.exit_code == 0, result.output
    marker = json.loads(result.stdout)
    assert marker["spec_hash"] == expected_hash


def test_lane_state_rehash_missing_marker_errors(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    epic_dir = tmp_path / "docs" / "epics" / "datum" / "epic-none"
    _write_lane_plan(epic_dir / "lane-plan.json", {"task-001": _some_lane()})

    result = runner.invoke(
        app,
        ["lane-state", "rehash", "--epic", "datum/epic-none", "--task", "task-001"],
    )
    assert result.exit_code != 0
    assert "lane_state_marker_not_found" in result.output


def test_lane_state_rehash_missing_lane_in_plan_errors(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    _write_marker(runner, epic="datum/epic-missing-lane", spec_hash="stale-hash")
    epic_dir = tmp_path / "docs" / "epics" / "datum" / "epic-missing-lane"
    _write_lane_plan(epic_dir / "lane-plan.json", {"some-other-task": _some_lane()})

    result = runner.invoke(
        app,
        [
            "lane-state",
            "rehash",
            "--epic",
            "datum/epic-missing-lane",
            "--task",
            "task-001",
        ],
    )
    assert result.exit_code != 0
    assert "lane_not_found_in_plan" in result.output


def test_lane_state_rehash_missing_plan_errors(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()
    runner = CliRunner()

    _write_marker(runner, epic="datum/epic-no-plan", spec_hash="stale-hash")

    result = runner.invoke(
        app,
        ["lane-state", "rehash", "--epic", "datum/epic-no-plan", "--task", "task-001"],
    )
    assert result.exit_code != 0
    assert "No lane-plan.json found" in result.output
