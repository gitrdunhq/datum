"""lane-plan finds existing tests that pin a lane's source text.

datum self-hosted run 20261012 (runner-core epic): two lanes' criteria said
"existing tests pass unchanged" while an existing test read the very source
file the lane rewrote (`readFileSync(join(__dirname, 'agents.ts'))` plus a
string assertion). The test was in no lane, so the lane could not update it
and GREEN could not pass. lane-plan now finds such tests: an unowned one
joins the lane's files, one owned by another lane is a named warning.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from datum.lane_plan import attach_source_pin_tests


def _write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def _lane(files: list[str]) -> dict:
    return {"files": list(files), "acceptance_criteria": ["a"], "red_note": "r"}


def test_an_unowned_ts_test_reading_the_lane_file_joins_the_lane(tmp_path):
    # Catches: the pin test staying outside every lane, so GREEN can never pass.
    _write(tmp_path, "skills/src/shared/agents.ts", "export const a = 1\n")
    _write(
        tmp_path,
        "skills/src/shared/agents-cli.test.ts",
        "const src = readFileSync(join(__dirname, 'agents.ts'), 'utf8')\n",
    )
    lanes = {"DAT-1": _lane(["skills/src/shared/agents.ts"])}
    ownership = {"skills/src/shared/agents.ts": "DAT-1"}
    warnings = attach_source_pin_tests(lanes, ownership, tmp_path)
    assert warnings == []
    assert lanes["DAT-1"]["files"] == [
        "skills/src/shared/agents.ts",
        "skills/src/shared/agents-cli.test.ts",
    ]
    assert lanes["DAT-1"]["source_pins"] == {
        "skills/src/shared/agents-cli.test.ts": ["skills/src/shared/agents.ts"]
    }
    assert ownership["skills/src/shared/agents-cli.test.ts"] == "DAT-1"


def test_relative_segments_resolve_against_the_test_directory(tmp_path):
    # Catches: only bare basenames matching, missing join(__dirname, '..', x)
    # and '../x' forms.
    _write(tmp_path, "skills/src/datum-go.ts", "x\n")
    _write(tmp_path, "skills/src/datum-validate.ts", "x\n")
    _write(
        tmp_path,
        "skills/src/shared/steps.test.ts",
        "const a = readFileSync(join(__dirname, '..', 'datum-go.ts'), 'utf8')\n"
        "const b = readFileSync(join(__dirname, '../datum-validate.ts'), 'utf8')\n",
    )
    lanes = {"L1": _lane(["skills/src/datum-go.ts", "skills/src/datum-validate.ts"])}
    attach_source_pin_tests(lanes, {}, tmp_path)
    assert lanes["L1"]["source_pins"] == {
        "skills/src/shared/steps.test.ts": [
            "skills/src/datum-go.ts",
            "skills/src/datum-validate.ts",
        ]
    }


def test_a_python_test_reading_from_the_repo_root_is_found(tmp_path):
    # Catches: Python pins (`ROOT / "datum" / "gate.py"`) going unseen.
    _write(tmp_path, "datum/gate.py", "x = 1\n")
    _write(
        tmp_path,
        "tests/test_gate_text.py",
        "ROOT = Path(__file__).resolve().parents[1]\n"
        'SRC = (ROOT / "datum" / "gate.py").read_text()\n',
    )
    lanes = {"L1": _lane(["datum/gate.py"])}
    attach_source_pin_tests(lanes, {}, tmp_path)
    assert "tests/test_gate_text.py" in lanes["L1"]["files"]


def test_a_same_named_file_in_another_directory_is_not_a_pin(tmp_path):
    # Catches: matching on basename alone, which would pull every test that
    # reads some other utils.ts into the lane.
    _write(tmp_path, "skills/src/shared/utils.ts", "x\n")
    _write(tmp_path, "skills/src/other/utils.ts", "x\n")
    _write(
        tmp_path,
        "skills/src/other/utils.test.ts",
        "const src = readFileSync(join(__dirname, 'utils.ts'), 'utf8')\n",
    )
    lanes = {"L1": _lane(["skills/src/shared/utils.ts"])}
    assert attach_source_pin_tests(lanes, {}, tmp_path) == []
    assert lanes["L1"]["files"] == ["skills/src/shared/utils.ts"]
    assert "source_pins" not in lanes["L1"]


def test_a_test_that_only_names_the_file_without_reading_it_is_not_a_pin(tmp_path):
    # Catches: imports and plain mentions counting as source-text pins.
    _write(tmp_path, "skills/src/tracker.ts", "x\n")
    _write(
        tmp_path,
        "skills/src/tracker.test.ts",
        "import { t } from './tracker'\nit('tracker.ts works', () => {})\n",
    )
    lanes = {"L1": _lane(["skills/src/tracker.ts"])}
    attach_source_pin_tests(lanes, {}, tmp_path)
    assert lanes["L1"]["files"] == ["skills/src/tracker.ts"]


def test_a_pin_test_owned_by_another_lane_is_a_named_warning(tmp_path):
    # Catches: silently moving a file between lanes, or saying nothing while
    # lane L1's GREEN breaks L2's test.
    _write(tmp_path, "skills/src/tracker.ts", "x\n")
    _write(
        tmp_path,
        "skills/src/tracker.test.ts",
        "const src = readFileSync(join(__dirname, 'tracker.ts'), 'utf8')\n",
    )
    lanes = {
        "L1": _lane(["skills/src/tracker.ts"]),
        "L2": _lane(["skills/src/tracker.test.ts"]),
    }
    ownership = {"skills/src/tracker.ts": "L1", "skills/src/tracker.test.ts": "L2"}
    warnings = attach_source_pin_tests(lanes, ownership, tmp_path)
    assert len(warnings) == 1
    assert "L1" in warnings[0] and "L2" in warnings[0]
    assert "skills/src/tracker.test.ts" in warnings[0]
    assert "skills/src/tracker.ts" in warnings[0]
    assert lanes["L1"]["files"] == ["skills/src/tracker.ts"]
    assert ownership["skills/src/tracker.test.ts"] == "L2"


def test_a_test_already_in_the_lane_is_recorded_without_a_warning(tmp_path):
    _write(tmp_path, "skills/src/tracker.ts", "x\n")
    _write(
        tmp_path,
        "skills/src/tracker.test.ts",
        "const src = readFileSync(join(__dirname, 'tracker.ts'), 'utf8')\n",
    )
    lanes = {"L1": _lane(["skills/src/tracker.ts", "skills/src/tracker.test.ts"])}
    ownership = {"skills/src/tracker.ts": "L1", "skills/src/tracker.test.ts": "L1"}
    assert attach_source_pin_tests(lanes, ownership, tmp_path) == []
    assert lanes["L1"]["files"] == [
        "skills/src/tracker.ts",
        "skills/src/tracker.test.ts",
    ]
    assert lanes["L1"]["source_pins"] == {
        "skills/src/tracker.test.ts": ["skills/src/tracker.ts"]
    }


def test_an_unowned_test_pinning_two_lanes_is_a_warning_not_an_addition(tmp_path):
    # Catches: handing a shared pin test to one lane arbitrarily.
    _write(tmp_path, "skills/src/a.ts", "x\n")
    _write(tmp_path, "skills/src/b.ts", "x\n")
    _write(
        tmp_path,
        "skills/src/ab.test.ts",
        "const a = readFileSync(join(__dirname, 'a.ts'), 'utf8')\n"
        "const b = readFileSync(join(__dirname, 'b.ts'), 'utf8')\n",
    )
    lanes = {"L1": _lane(["skills/src/a.ts"]), "L2": _lane(["skills/src/b.ts"])}
    warnings = attach_source_pin_tests(lanes, {}, tmp_path)
    assert len(warnings) == 1
    assert (
        "L1" in warnings[0]
        and "L2" in warnings[0]
        and "skills/src/ab.test.ts" in warnings[0]
    )
    assert "skills/src/ab.test.ts" not in lanes["L1"]["files"]
    assert "skills/src/ab.test.ts" not in lanes["L2"]["files"]


def test_a_pin_in_another_language_is_a_warning_not_an_addition(tmp_path):
    # Catches: a pytest file joining a TypeScript lane, which the lane's
    # vitest command would never run.
    _write(tmp_path, "skills/src/tracker.ts", "x\n")
    _write(
        tmp_path,
        "tests/test_tracker_text.py",
        'SRC = (ROOT / "skills" / "src" / "tracker.ts").read_text()\n',
    )
    lanes = {"L1": _lane(["skills/src/tracker.ts"])}
    warnings = attach_source_pin_tests(lanes, {}, tmp_path)
    assert len(warnings) == 1
    assert "tests/test_tracker_text.py" in warnings[0]
    assert lanes["L1"]["files"] == ["skills/src/tracker.ts"]


def test_the_lane_files_list_is_not_shared_with_the_task(tmp_path):
    # Catches: appending to the task's own list, which leaks the pin test
    # into TASKS.md and tasks.json.
    _write(tmp_path, "skills/src/tracker.ts", "x\n")
    _write(
        tmp_path,
        "skills/src/tracker.test.ts",
        "const src = readFileSync(join(__dirname, 'tracker.ts'), 'utf8')\n",
    )
    task_files = ["skills/src/tracker.ts"]
    lanes = {"L1": {"files": task_files, "acceptance_criteria": ["a"], "red_note": "r"}}
    attach_source_pin_tests(lanes, {}, tmp_path)
    assert task_files == ["skills/src/tracker.ts"]


def test_node_modules_and_new_files_are_ignored(tmp_path):
    # Catches: scanning vendored tests, and looking for pins of files that
    # do not exist yet (no existing test can pin them).
    _write(tmp_path, "skills/src/tracker.ts", "x\n")
    _write(
        tmp_path,
        "node_modules/pkg/tracker.test.ts",
        "readFileSync(join(__dirname, '../../skills/src/tracker.ts'))\n",
    )
    _write(
        tmp_path,
        "skills/src/new.test.ts",
        "const src = readFileSync(join(__dirname, 'new.ts'), 'utf8')\n",
    )
    lanes = {"L1": _lane(["skills/src/tracker.ts", "skills/src/new.ts"])}
    assert attach_source_pin_tests(lanes, {}, tmp_path) == []
    assert lanes["L1"]["files"] == ["skills/src/tracker.ts", "skills/src/new.ts"]


def test_lane_plan_cli_adds_the_pin_and_reports_it(tmp_path):
    # Catches: the check existing but never running from `datum lane-plan`.
    repo = tmp_path
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    _write(repo, "skills/src/tracker.ts", "export const t = 1\n")
    _write(
        repo,
        "skills/src/tracker.test.ts",
        "const src = readFileSync(join(__dirname, 'tracker.ts'), 'utf8')\n",
    )
    tasks = {
        "tasks": [
            {
                "id": "task-001",
                "slug": "tracker",
                "title": "tracker",
                "acceptance_criteria": ["a"],
                "files": ["skills/src/tracker.ts"],
                "reads": [],
                "depends_on": [],
                "red_note": "rewrite tracker",
            }
        ]
    }
    _write(repo, "docs/epics/e/tasks.json", json.dumps(tasks))
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    r = subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.lane_plan",
            "--input",
            "docs/epics/e/tasks.json",
            "--output",
            "docs/epics/e/lane-plan.json",
            "--md-output",
            "docs/epics/e/TASKS.md",
        ],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["source_pins"] == {
        "task-001": {"skills/src/tracker.test.ts": ["skills/src/tracker.ts"]}
    }
    plan = json.loads((repo / "docs/epics/e/lane-plan.json").read_text())
    assert "skills/src/tracker.test.ts" in plan["lanes"]["task-001"]["files"]
    assert plan["file_ownership"]["skills/src/tracker.test.ts"] == "task-001"
    assert (
        "skills/src/tracker.test.ts" not in (repo / "docs/epics/e/TASKS.md").read_text()
    )
