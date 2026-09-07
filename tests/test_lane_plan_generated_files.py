"""datum self-hosted wf_2749a43b-680 (integration-lanes plan): the decomposer
put the generated bundle skills/datum-properties.js in a lane's files next to
its prompt source, and lane-plan halted on the language-mismatch guard with a
message about test commands. The real defect is upstream: a generated file
(first line carries `@generated`) is never a lane file — it is rebuilt from
its source by scripts/build-workflows.sh after merge. lane-plan names it.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from datum.lane_plan import validate_lane_files_not_generated


def _repo(tmp_path: Path) -> Path:
    (tmp_path / "skills" / "src").mkdir(parents=True)
    (tmp_path / "skills" / "datum-properties.js").write_text(
        "// @generated — DO NOT EDIT. Source: skills/src/datum-properties.ts\nexport const meta = {}\n"
    )
    (tmp_path / "skills" / "src" / "properties.ts").write_text("export const x = 1\n")
    return tmp_path


def test_a_generated_file_in_a_lane_is_named_with_its_source(tmp_path):
    repo = _repo(tmp_path)
    lanes = {
        "task-009": {
            "files": ["skills/src/properties.ts", "skills/datum-properties.js"]
        },
        "task-001": {"files": ["skills/src/properties.ts"]},
    }
    errors = validate_lane_files_not_generated(lanes, repo_root=repo)
    assert len(errors) == 1
    assert "task-009" in errors[0]
    assert "skills/datum-properties.js" in errors[0]
    assert "@generated" in errors[0]
    assert (
        "skills/src/datum-properties.ts" in errors[0]
    )  # the source named in the banner


def test_files_that_do_not_exist_yet_or_carry_no_banner_pass(tmp_path):
    repo = _repo(tmp_path)
    lanes = {"t": {"files": ["skills/src/properties.ts", "datum/new_module.py"]}}
    assert validate_lane_files_not_generated(lanes, repo_root=repo) == []


def test_lane_plan_cli_exits_1_naming_generated_files(tmp_path):
    repo = _repo(tmp_path)
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    (repo / "docs" / "epics" / "e").mkdir(parents=True)
    tasks = {
        "tasks": [
            {
                "id": "task-001",
                "slug": "prompt",
                "title": "prompt",
                "acceptance_criteria": ["a"],
                "files": ["skills/src/properties.ts", "skills/datum-properties.js"],
                "reads": [],
                "depends_on": [],
                "red_note": "prompt-only change",
            }
        ]
    }
    (repo / "docs" / "epics" / "e" / "tasks.json").write_text(json.dumps(tasks))
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
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        env=env,
    )
    assert r.returncode == 1, r.stdout + r.stderr
    payload = json.loads(r.stdout.strip().splitlines()[-1])
    assert payload["error"] == "Generated file(s) in lane scope"
    assert "skills/datum-properties.js" in payload["details"][0]
