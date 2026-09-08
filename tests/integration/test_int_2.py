"""INT-09: the epic's own lane-plan makes the final task cut with the sole
rule "no single-layer task".

This is an INTEGRATION lane (kind="integration", expect_tests_pass=True).
The plan file docs/epics/datum/integration-lanes-2/lane-plan.json is the
already-merged artifact under test: task-001, task-002 and task-003 (and
their file lists) are fixed facts, not code to be written by GREEN. These
tests are expected to PASS on first run — a failing test here is a real
finding about the plan, not a RED-stage placeholder to be turned green
later.

INT-09 text (verbatim from the lane spec):
    Plan makes the final task cut with the sole rule "no single-layer
    task"; task-001 crosses digest+export (Python producer layer only per
    its own scope) while task-002 crosses runner+types+prompt (R1, R2,
    R4.2) and task-003 crosses classifier+destination-map+label-map (R3)
    — each of task-002 and task-003 individually spans multiple layers,
    and R6 is verified by this epic's own Act run rather than as a
    separate task.
"""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

from datum import gate
from datum.lane_plan import build_lane_plan, find_task_id_collisions
from datum.task_renumber import renumber_tasks

_PLAN_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "epics"
    / "datum"
    / "integration-lanes-2"
    / "lane-plan.json"
)

# Keyword -> layer tag. A file may match more than one keyword; the layer
# tags actually present per task are what INT-09 calls "layers".
_LAYER_KEYWORDS = {
    "lane_plan_digest": "digest",
    "lane_spec_export": "export",
    "datum-tdd-act-lane": "lane-runner",
    "types.ts": "types",
    "prompts.ts": "prompt",
    "red.md": "prompt",
    "triage-classify": "classifier",
    "datum-tdd-act-triage": "triage-label-map",
    "verdicts": "verdicts",
}


def _load_plan() -> dict:
    return json.loads(_PLAN_PATH.read_text())


def _layer_tags(files: list) -> set:
    tags = set()
    for f in files:
        for kw, tag in _LAYER_KEYWORDS.items():
            if kw in f:
                tags.add(tag)
    return tags


def test_int09_task_001_crosses_digest_and_export_within_python_producer_scope():
    plan = _load_plan()
    task_001 = plan["lanes"]["task-001"]

    assert task_001["files"] == [
        "datum/lane_plan_digest.py",
        "tests/test_lane_plan_digest_expect_tests_pass.py",
        "tests/test_lane_spec_export_integration_fields.py",
    ]

    tags = _layer_tags(task_001["files"])
    assert tags == {"digest", "export"}

    # "Python producer layer only per its own scope": no TypeScript/skills
    # file appears in task-001's file list.
    assert not any(f.startswith("skills/") for f in task_001["files"])
    assert task_001["kind"] == "behavioral"


def test_int09_task_002_crosses_runner_types_and_prompt_layers():
    plan = _load_plan()
    task_002 = plan["lanes"]["task-002"]

    assert task_002["files"] == [
        "skills/src/datum-tdd-act-lane.ts",
        "skills/src/shared/types.ts",
        "skills/src/shared/prompts.ts",
        "skills/src/prompts/red.md",
        "skills/src/datum-tdd-act-lane.integration.test.ts",
    ]

    tags = _layer_tags(task_002["files"])
    assert tags == {"lane-runner", "types", "prompt"}
    assert len(tags) == 3

    # task-002 individually spans multiple layers (not single-layer).
    assert len(tags) > 1


def test_int09_task_003_crosses_classifier_and_label_map_layers():
    plan = _load_plan()
    task_003 = plan["lanes"]["task-003"]

    assert task_003["files"] == [
        "skills/src/shared/triage-classify.ts",
        "skills/src/datum-tdd-act-triage.ts",
        "skills/src/shared/triage-classify-code-defect.test.ts",
        "skills/src/shared/triage-classify.test.ts",
        "skills/src/shared/verdicts.property.test.ts",
    ]

    tags = _layer_tags(task_003["files"])
    assert tags == {"classifier", "triage-label-map", "verdicts"}
    assert len(tags) == 3

    # task-003 individually spans multiple layers (not single-layer).
    assert len(tags) > 1


def test_int09_no_single_layer_task_among_task_001_002_003():
    plan = _load_plan()

    for task_id in ("task-001", "task-002", "task-003"):
        lane = plan["lanes"][task_id]
        tags = _layer_tags(lane["files"])
        assert len(tags) >= 2, (
            f"{task_id} is single-layer under INT-09's tag scheme "
            f"(tags={tags}, files={lane['files']})"
        )


def test_int09_r6_is_not_a_dedicated_task():
    plan = _load_plan()

    # R6 (the real-merged-branch case) is explicitly deferred to this
    # epic's own Act run rather than being carved out as its own lane —
    # no lane title names R6 as its scope.
    for lane_id, lane in plan["lanes"].items():
        assert "R6" not in lane["title"], (
            f"{lane_id} claims R6 as a dedicated task, contradicting "
            "INT-09's statement that R6 is verified by the epic's own "
            "Act run"
        )

    # R6 is nonetheless a real, named requirement elsewhere in the plan
    # (task-INT-3's red_note), so this isn't just an absent string.
    r6_mentions = [
        lane_id
        for lane_id, lane in plan["lanes"].items()
        if re.search(r"\bR6\b", lane.get("red_note", ""))
        or re.search(r"\bR6\b", "; ".join(lane.get("acceptance_criteria", [])))
    ]
    assert set(r6_mentions) == {"task-INT-2", "task-INT-3"}


# ---------------------------------------------------------------------------
# INV-Q3 (from docs/epics/datum/state-single-source-of-truth/lane-plan.json):
# "Migration lands incrementally, one module per lane, in the fixed order
# (tested modules first, pipeline_scheduler.py last), each independently
# reviewable and revertible."
#
# This is a second, unrelated integration lane that happens to share the
# INT-2 slot name across two different epics. Its plan file lives at a
# different path from the INT-09 plan above.
# ---------------------------------------------------------------------------

_STATE_PLAN_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "epics"
    / "datum"
    / "state-single-source-of-truth"
    / "lane-plan.json"
)

_STATE_MODULE_TASKS = [
    "task-002",
    "task-003",
    "task-004",
    "task-005",
    "task-006",
    "task-007",
    "task-008",
    "task-009",
    "task-010",
    "task-011",
]


def _load_state_plan() -> dict:
    return json.loads(_STATE_PLAN_PATH.read_text())


def test_invq3_pipeline_scheduler_migrates_last_among_module_tasks():
    plan = _load_state_plan()
    order = plan["topological_order"]

    indices = {t: order.index(t) for t in _STATE_MODULE_TASKS}
    assert indices["task-011"] == max(indices.values()), (
        "task-011 (pipeline_scheduler.py) must be ordered after every other "
        f"module-migration task; indices={indices}"
    )
    # task-001 (the decision doc) must precede every module task.
    assert order.index("task-001") < min(indices.values())


def test_invq3_pipeline_scheduler_lane_owns_exactly_one_production_module():
    plan = _load_state_plan()
    task_011 = plan["lanes"]["task-011"]

    assert task_011["files"] == [
        "datum/pipeline_scheduler.py",
        "tests/test_pipeline_scheduler.py",
    ]
    production_files = [f for f in task_011["files"] if f.startswith("datum/")]
    assert len(production_files) == 1


def test_invq3_pipeline_scheduler_lane_is_independently_revertible():
    plan = _load_state_plan()
    lanes = plan["lanes"]
    task_011_files = set(lanes["task-011"]["files"])

    for task_id, lane in lanes.items():
        if task_id == "task-011":
            continue
        shared = task_011_files & set(lane.get("files", []))
        assert not shared, (
            f"task-011's files overlap with {task_id}'s files ({shared}); "
            "pipeline_scheduler.py's lane would not be independently "
            "revertible"
        )


def test_invq3_each_module_task_pairs_its_production_file_with_its_own_test():
    plan = _load_state_plan()
    lanes = plan["lanes"]

    for task_id in _STATE_MODULE_TASKS:
        files = lanes[task_id]["files"]
        assert any(
            f.startswith("tests/") for f in files
        ), f"{task_id} has no owned test file: {files}"
        assert any(
            f.startswith("datum") for f in files
        ), f"{task_id} has no owned production module: {files}"


def test_invq3_pipeline_scheduler_depends_on_the_decision_and_the_thin_slice():
    plan = _load_state_plan()
    task_011 = plan["lanes"]["task-011"]

    assert set(task_011["depends_on"]) == {"task-001", "task-002"}
    assert task_011["kind"] == "behavioral"


# ---------------------------------------------------------------------------
# II-005 (from docs/epics/datum/monotonic-task-ids/lane-plan.json): a lane id
# renumbered by task-010 in dependency order flows unchanged through
# task-007's kind-based gate classification, task-011's counter-based
# integration-lane synthesis, task-012's kind-based counting, and task-013's
# collision detection -- the same `<PREFIX>-<n>` string is never reshaped
# between these stages.
#
# This is a THIRD, unrelated integration lane sharing the INT-2 slot name
# across a third epic (monotonic-task-ids). These tests exercise the actual
# merged production code (datum.task_renumber, datum.lane_plan, datum.gate)
# end to end and are expected to PASS on first run.
# ---------------------------------------------------------------------------

_DAT_ID_RE = re.compile(r"^DAT-\d+$")


def _ii005_source_tasks() -> list:
    return [
        {
            "id": "task-001",
            "title": "First task",
            "files": ["src/a.py"],
            "acceptance_criteria": ["a works"],
            "red_note": "n/a",
            "depends_on": [],
        },
        {
            "id": "task-002",
            "title": "Second task",
            "files": ["src/b.py"],
            "acceptance_criteria": ["b works"],
            "red_note": "n/a",
            "depends_on": ["task-001"],
        },
    ]


def _ii005_invariant_table(covers: str) -> str:
    return (
        "## Integration Invariants\n\n"
        "| ID | Invariant | Covers | Source |\n"
        "| --- | --- | --- | --- |\n"
        f"| INV-Z | flows unchanged | {covers} | spec:ii-005 |\n"
    )


def test_ii005_renumbered_id_is_unchanged_string_in_int_lane_synthesis(tmp_path):
    """task-010's renumber output feeds directly into task-011's
    derive_integration_lanes via build_lane_plan: the task lane's renumbered
    id must appear byte-for-byte (not reshaped) as the integration lane's
    depends_on entry, and the integration lane's own id must continue the
    same PREFIX-<n> counter (never containing 'INT')."""
    renumbered = renumber_tasks(_ii005_source_tasks(), "DAT", 500)
    ids = [t["id"] for t in renumbered]
    assert ids == ["DAT-500", "DAT-501"]

    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_ii005_invariant_table("DAT-501"))

    result = build_lane_plan(
        tasks=renumbered,
        sorted_ids=ids,
        ownership={},
        global_test_command="pytest",
        repo_root=tmp_path,
        properties_path=properties_path,
    )

    lanes = result["lanes"]
    assert lanes["DAT-501"]["id"] == "DAT-501"

    int_lane_ids = [
        lid for lid, lane in lanes.items() if lane.get("kind") == "integration"
    ]
    assert len(int_lane_ids) == 1
    int_lane_id = int_lane_ids[0]
    assert _DAT_ID_RE.match(int_lane_id)
    assert "INT" not in int_lane_id
    # the counter continues past the highest renumbered task id (DAT-501)
    assert int(int_lane_id.split("-")[1]) > 501

    int_lane = lanes[int_lane_id]
    # the SAME string produced by renumber_tasks, not a stale task-002
    assert int_lane["depends_on"] == ["DAT-501"]
    assert int_lane["kind"] == "integration"
    assert int_lane_id in result["topological_order"]
    assert result["topological_order"].index(int_lane_id) > result[
        "topological_order"
    ].index("DAT-501")


def test_ii005_renumbered_id_recognised_by_gate_kind_classification_unreshaped(
    tmp_path, monkeypatch, capsys
):
    """The exact lane-plan.json produced above (with its PREFIX-<n> ids)
    must pass datum.gate's kind-based integration-lane classification with
    no reshaping of the id anywhere along the way -- gate_plan must exit 0
    ('Plan gate passed'), proving DAT-501/DAT-50x ids are recognised purely
    via `kind`, not by a `task-INT-` prefix check."""
    renumbered = renumber_tasks(_ii005_source_tasks(), "DAT", 500)
    ids = [t["id"] for t in renumbered]

    properties_text = _ii005_invariant_table("DAT-501")
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(properties_text)

    result = build_lane_plan(
        tasks=renumbered,
        sorted_ids=ids,
        ownership={},
        global_test_command="pytest",
        repo_root=tmp_path,
        properties_path=properties_path,
    )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(gate, "resolve_epic_dir", lambda: tmp_path / "no-such-epic-dir")
    (tmp_path / "TASKS.md").write_text("# Tasks\n")
    (tmp_path / "lane-plan.json").write_text(json.dumps(result))
    (tmp_path / "tasks.json").write_text(json.dumps(renumbered))
    (tmp_path / "PROPERTIES.md").write_text(properties_text)

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    assert exc.value.code == 0, capsys.readouterr().out


def _ii005_hermetic_git_env(tmp_path) -> dict:
    env = os.environ.copy()
    env["GIT_CONFIG_GLOBAL"] = str(tmp_path / "empty-gitconfig")
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_AUTHOR_NAME"] = "Datum Test"
    env["GIT_AUTHOR_EMAIL"] = "datum-test@example.com"
    env["GIT_COMMITTER_NAME"] = "Datum Test"
    env["GIT_COMMITTER_EMAIL"] = "datum-test@example.com"
    return env


def _ii005_git(args, cwd, env):
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True
    )


def _ii005_commit_task(repo_root, rel_path, task_id, env):
    path = repo_root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            [
                {
                    "id": task_id,
                    "title": f"Task {task_id}",
                    "acceptance_criteria": ["x"],
                    "files": [f"src/{task_id.lower().replace('-', '_')}.py"],
                    "red_note": "n/a",
                    "depends_on": [],
                }
            ]
        )
    )
    _ii005_git(["add", rel_path], repo_root, env)
    _ii005_git(["commit", "-q", "-m", f"add {task_id}"], repo_root, env)


def test_ii005_renumbered_id_flows_unreshaped_into_collision_detection(tmp_path):
    """The same PREFIX-<n> string task-010 produced (task-013's consumer)
    must be the exact string matched by find_task_id_collisions -- proving
    the id is never reshaped on its way into the collision check either."""
    renumbered = renumber_tasks(_ii005_source_tasks(), "DAT", 500)
    task_002_new_id = renumbered[1]["id"]
    assert task_002_new_id == "DAT-501"

    env = _ii005_hermetic_git_env(tmp_path)
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    _ii005_git(["init", "-q", "-b", "main"], repo_root, env)
    _ii005_git(["config", "core.hooksPath", "/dev/null"], repo_root, env)

    _ii005_commit_task(repo_root, "docs/epics/epic-a/tasks.json", task_002_new_id, env)
    _ii005_commit_task(repo_root, "docs/epics/epic-b/tasks.json", task_002_new_id, env)

    collisions = find_task_id_collisions(repo_root, "DAT", renumbered)

    assert len(collisions) == 1
    assert collisions[0]["id"] == task_002_new_id
    assert set(collisions[0]["paths"]) == {
        "docs/epics/epic-a/tasks.json",
        "docs/epics/epic-b/tasks.json",
    }
