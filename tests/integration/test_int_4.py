"""Integration invariants covering task-002, task-003 (task-INT-4).

This is an INTEGRATION lane (kind="integration", expect_tests_pass=True):
its tests exercise already-merged code from task-002 (the RED-only lane
runner in skills/src/datum-tdd-act-lane.ts) and task-003 (the classifier in
skills/src/shared/triage-classify.ts). Both are TypeScript; this test file
is Python (per this lane's skeleton/framework), so the byte-for-byte format
agreement invariants (INT-01, INT-04) are verified at the source-literal
level: the runner's error-string template and the classifier's extraction
regex are both TypeScript source text, and this suite reconstructs the
runner's real output from that literal template, then applies the
classifier's real regex literal (transcribed from source) against it.

Per the lane's contract_summary, these tests are expected to PASS against
the already-merged task-002/task-003 code — a failure here is a genuine
finding (format drift), not the normal RED "not implemented yet" signal.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

from datum import gate

ROOT = Path(__file__).resolve().parents[2]
LANE_TS = ROOT / "skills" / "src" / "datum-tdd-act-lane.ts"
TRIAGE_TS = ROOT / "skills" / "src" / "shared" / "triage-classify.ts"
LANE_PLAN_JSON = (
    ROOT / "docs" / "epics" / "datum" / "integration-lanes-2" / "lane-plan.json"
)

# Transcribed verbatim from skills/src/shared/triage-classify.ts's
# `coveredMatch = text.match(/covered ([^;]+)/)` — the ONE regex INT-04
# says the classifier uses to parse the covered-ids segment.
_COVERED_RE = re.compile(r"covered ([^;]+)")


def _runner_error(covered: str, invariant_ids: str, exit_code: int) -> str:
    """Reconstruct task-002's byte-exact template from
    skills/src/datum-tdd-act-lane.ts:803:
        `integration_failed: covered ${covered}; invariants ${invariantIds} (independent verify exit=${redVerifyVerdict.exit})`
    """
    return (
        f"integration_failed: covered {covered}; invariants {invariant_ids} "
        f"(independent verify exit={exit_code})"
    )


# ── INT-01: runner format and classifier regex agree byte-for-byte ──────


def test_int_01_classifier_regex_extracts_every_covered_task_id():
    error = _runner_error("task-002, task-003", "INV-01, INV-03", 1)

    match = _COVERED_RE.search(error)

    assert match is not None
    covered_ids = match.group(1).strip()
    assert covered_ids == "task-002, task-003"
    assert "task-002" in covered_ids
    assert "task-003" in covered_ids


def test_int_01_triage_source_uses_the_same_regex_literal():
    triage_source = TRIAGE_TS.read_text()
    lane_source = LANE_TS.read_text()

    # The classifier's literal regex text must be exactly the one INT-01
    # names, not a paraphrase or a differently-anchored pattern.
    assert "text.match(/covered ([^;]+)/)" in triage_source
    # The runner's literal template must still exist verbatim in source —
    # if either side drifts, this pin catches it before classify() does.
    assert (
        "`integration_failed: covered ${covered}; invariants ${invariantIds} "
        "(independent verify exit=${redVerifyVerdict.exit})`" in lane_source
    )


# ── INT-04: exact byte-for-byte string, single extraction site, edge cases ──


def test_int_04_error_string_is_byte_exact_for_the_spec_example():
    error = _runner_error("task-002, task-003", "INV-01, INV-03", 1)

    assert error == (
        "integration_failed: covered task-002, task-003; "
        "invariants INV-01, INV-03 (independent verify exit=1)"
    )


def test_int_04_regex_extracts_single_covered_id():
    error = _runner_error("task-002", "INV-01", 1)

    match = _COVERED_RE.search(error)

    assert match is not None
    assert match.group(1).strip() == "task-002"


def test_int_04_error_with_no_covered_segment_does_not_match_and_falls_back():
    # INT-04: "the classifier extracts task ids with exactly one regex ...
    # and nothing else parses the string" — an integration_failed error
    # with no `covered ` segment must not match, and the classifier's
    # fallback literal must be the documented 'unknown lane(s)'.
    error = "integration_failed: unexpected format; invariants INV-01 (independent verify exit=2)"

    match = _COVERED_RE.search(error)

    assert match is None
    triage_source = TRIAGE_TS.read_text()
    assert "coveredMatch ? coveredMatch[1].trim() : 'unknown lane(s)'" in triage_source


def test_int_04_exactly_one_covered_extraction_regex_literal_in_classifier():
    triage_source = TRIAGE_TS.read_text()

    # "nothing else parses the string": only one `covered (...)`-shaped
    # regex literal should exist in the classifier source.
    occurrences = re.findall(r"/covered \(\[\^;\]\+\)/", triage_source)
    assert len(occurrences) == 1


# ── INT-03: this epic's own Plan/Act produced a terminal-RED INT lane ────


def test_int_03_epic_lane_plan_schedules_a_terminal_integration_lane():
    lane_plan = json.loads(LANE_PLAN_JSON.read_text())
    lanes = lane_plan["lanes"]

    int_lanes = {
        lid: lane for lid, lane in lanes.items() if re.match(r"^task-INT-\d+$", lid)
    }

    assert int_lanes, "expected at least one task-INT-<n> lane in lane-plan.json"

    this_lane = lanes["task-INT-4"]
    assert this_lane["kind"] == "integration"
    assert this_lane["expect_tests_pass"] is True
    assert this_lane["depends_on"] == ["task-002", "task-003"]


# ── INT-10: gate_properties/gate_plan surface a missing INT setup ────────


def _lane(lid, files, *, depends_on=None, kind=None, stage="behavioral"):
    lane = {
        "id": lid,
        "title": f"Lane {lid}",
        "files": files,
        "acceptance_criteria": ["it works"],
        "red_note": "do the red thing",
        "stage": stage,
    }
    if depends_on is not None:
        lane["depends_on"] = depends_on
    if kind is not None:
        lane["kind"] = kind
    return lane


def _plan(lanes):
    lane_ids = list(lanes)
    return {
        "schema_version": "1.0",
        "total_lanes": len(lanes),
        "topological_order": lane_ids,
        "file_ownership": {},
        "lanes": lanes,
    }


@pytest.fixture
def epic_dir(tmp_path, monkeypatch):
    """Isolate gate resolution to tmp_path, bypassing git branch lookup —
    same pattern as tests/test_gate_plan_integration_lanes.py's epic_dir."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(gate, "resolve_epic_dir", lambda: tmp_path / "no-such-epic-dir")
    return tmp_path


def _categories_body() -> str:
    categories = [
        "SAFETY",
        "LIVENESS",
        "INVARIANT",
        "BOUNDARY",
        "IDEMPOTENT",
        "ORDERING",
        "ISOLATION",
        "PERFORMANCE",
        "SECURITY",
        "OBSERVABILITY",
        "COMPATIBILITY",
    ]
    body = "\n".join(f"- {c}: documented." for c in categories)
    return f"# PROPERTIES.md\n\n{body}\n\nSee task-001 for traceability.\n"


def test_int_10_gate_properties_fails_without_integration_invariants_table(
    epic_dir, capsys
):
    (epic_dir / "PROPERTIES.md").write_text(_categories_body())

    with pytest.raises(SystemExit) as exc:
        gate.gate_properties(True, {})

    assert exc.value.code == 1
    out_lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    result = json.loads(out_lines[-1])
    assert result["passed"] is False
    assert "missing_integration_invariants_section" in result["message"]


# ── INV-Q2: load_state/save_state/update_state canonical contract ───────
#
# This section covers *this* lane's own acceptance criterion (INV-Q2,
# depends_on task-001/task-004): the state module's public read/write/mutate
# contract is adopted unchanged. These assertions pin the exact signatures
# and observable behaviour of datum.state.load_state / save_state /
# update_state as already merged — a genuine finding here is format/contract
# drift, not "not implemented yet".

import inspect

import datum.state as state_mod


def test_int_q2_load_state_has_the_canonical_zero_arg_signature():
    sig = inspect.signature(state_mod.load_state)
    assert list(sig.parameters) == []


def test_int_q2_save_state_has_the_canonical_single_positional_signature():
    sig = inspect.signature(state_mod.save_state)
    assert list(sig.parameters) == ["state"]


def test_int_q2_update_state_has_the_canonical_mutator_signature():
    sig = inspect.signature(state_mod.update_state)
    assert list(sig.parameters) == ["mutator"]


def test_int_q2_load_state_returns_empty_dict_with_no_db(tmp_path, monkeypatch):
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    assert state_mod.load_state() == {}


def test_int_q2_save_state_then_load_state_round_trips_unchanged(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state({"run_id": "epic-q2-test", "current_phase": "plan"})
    loaded = state_mod.load_state()

    assert loaded["run_id"] == "epic-q2-test"
    assert loaded["current_phase"] == "plan"
    assert "updated_at" in loaded


def test_int_q2_save_state_does_not_write_json_cache(tmp_path, monkeypatch):
    """amended: test_int_q2_save_state_writes_write_through_json_cache —
    superseded by task-012 AC1. save_state() must write only to
    .datum/state.db; the legacy write-through .datum/state.json cache is
    removed. docs/architecture/state-store.md documents the removal."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state({"run_id": "epic-q2-cache"})

    cache_path = tmp_path / ".datum" / "state.json"
    assert not cache_path.exists()
    loaded = state_mod.load_state()
    assert loaded["run_id"] == "epic-q2-cache"


def test_int_q2_update_state_applies_mutator_and_returns_true(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    state_mod.save_state({"run_id": "epic-q2-mutate", "in_flight_count": 0})

    def bump(state):
        state["in_flight_count"] += 1

    result = state_mod.update_state(bump)

    assert result is True
    assert state_mod.load_state()["in_flight_count"] == 1


def test_int_q2_update_state_returns_false_when_no_state_exists(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    result = state_mod.update_state(lambda state: state.update(x=1))

    assert result is False
    out = capsys.readouterr().out
    assert json.loads(out.strip().splitlines()[-1])["error"] == "no_state"


def test_int_10_gate_plan_warns_no_integration_invariants_when_no_int_lane(
    epic_dir, capsys
):
    lanes = {"task-001": _lane("task-001", ["a.py"])}
    plan = _plan(lanes)
    (epic_dir / "TASKS.md").write_text("# Tasks\n")
    (epic_dir / "lane-plan.json").write_text(json.dumps(plan))
    (epic_dir / "tasks.json").write_text(json.dumps([{"id": "task-001"}]))
    (epic_dir / "PROPERTIES.md").write_text(
        "## Integration Invariants\n\n"
        "| ID | Invariant | Covers | Source |\n"
        "| --- | --- | --- | --- |\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_plan(True, {})

    captured = capsys.readouterr()
    assert exc.value.code == 0
    assert "no_integration_invariants" in captured.err
    assert json.loads(captured.out) == {"passed": True, "message": "Plan gate passed"}


# ── II-004: counter/collision checks are scoped to committed HEAD only ───
#
# next_task_number(repo_root, prefix) and find_task_id_collisions(repo_root,
# prefix, tasks) both walk `git ls-tree -r HEAD` + `git show HEAD:<path>`
# (datum/task_ids.py, datum/lane_plan.py) — never the working tree, never
# other branches' commits that HEAD doesn't include. Consequence: an id
# minted on an unmerged branch never bumps next_task_number on the current
# branch, and a cross-branch duplicate id is invisible to
# find_task_id_collisions until the branches are actually merged together
# (caught post hoc, never prevented pre-merge).

from datum.lane_plan import find_task_id_collisions
from datum.task_ids import next_task_number


def _ii004_hermetic_env(tmp_path: Path) -> dict:
    env = os.environ.copy()
    env["GIT_CONFIG_GLOBAL"] = str(tmp_path / "empty-gitconfig")
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_AUTHOR_NAME"] = "Datum Test"
    env["GIT_AUTHOR_EMAIL"] = "datum-test@example.com"
    env["GIT_COMMITTER_NAME"] = "Datum Test"
    env["GIT_COMMITTER_EMAIL"] = "datum-test@example.com"
    return env


def _ii004_git(args: list[str], cwd: Path, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True
    )


def _ii004_init_repo(repo_root: Path, env: dict) -> Path:
    repo_root.mkdir(parents=True, exist_ok=True)
    _ii004_git(["init", "-q", "-b", "main"], repo_root, env)
    _ii004_git(["config", "core.hooksPath", "/dev/null"], repo_root, env)
    return repo_root


def _ii004_commit_file(
    repo_root: Path, rel_path: str, content: str, env: dict, message: str = "add file"
) -> None:
    path = repo_root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    _ii004_git(["add", rel_path], repo_root, env)
    _ii004_git(["commit", "-q", "-m", message], repo_root, env)


def _ii004_valid_task(task_id: str, files: list[str] | None = None) -> dict:
    return {
        "id": task_id,
        "title": f"Task {task_id}",
        "acceptance_criteria": ["does the thing"],
        "files": files or [f"src/{task_id.lower().replace('-', '_')}.py"],
        "red_note": "n/a",
        "depends_on": [],
    }


def test_ii004_next_task_number_ignores_ids_committed_only_on_another_branch(
    tmp_path,
):
    env = _ii004_hermetic_env(tmp_path)
    repo_root = _ii004_init_repo(tmp_path / "repo", env)
    _ii004_commit_file(
        repo_root,
        "docs/epics/epic-a/tasks.json",
        json.dumps([_ii004_valid_task("DAT-1")]),
        env,
    )

    _ii004_git(["checkout", "-q", "-b", "feature"], repo_root, env)
    _ii004_commit_file(
        repo_root,
        "docs/epics/epic-a/other.json",
        json.dumps([_ii004_valid_task("DAT-99")]),
        env,
        message="mint DAT-99 on unmerged feature branch",
    )
    _ii004_git(["checkout", "-q", "main"], repo_root, env)

    number = next_task_number(repo_root, "DAT")

    # main's committed HEAD only ever saw DAT-1; DAT-99 lives on the
    # unmerged feature branch and must never count toward the max.
    assert number == 2


def test_ii004_next_task_number_ignores_uncommitted_working_tree_content(tmp_path):
    env = _ii004_hermetic_env(tmp_path)
    repo_root = _ii004_init_repo(tmp_path / "repo", env)
    _ii004_commit_file(
        repo_root,
        "docs/epics/epic-a/tasks.json",
        json.dumps([_ii004_valid_task("DAT-3")]),
        env,
    )

    # Write, but do not commit, a file naming a much higher id.
    uncommitted = repo_root / "docs" / "epics" / "epic-a" / "scratch.json"
    uncommitted.write_text(json.dumps([_ii004_valid_task("DAT-500")]))

    number = next_task_number(repo_root, "DAT")

    assert number == 4


def test_ii004_cross_branch_duplicate_id_not_prevented_before_merge(tmp_path):
    env = _ii004_hermetic_env(tmp_path)
    repo_root = _ii004_init_repo(tmp_path / "repo", env)
    _ii004_commit_file(
        repo_root,
        "docs/epics/epic-a/tasks.json",
        json.dumps([_ii004_valid_task("DAT-9")]),
        env,
    )

    _ii004_git(["checkout", "-q", "-b", "feature"], repo_root, env)
    _ii004_commit_file(
        repo_root,
        "docs/epics/epic-b/tasks.json",
        json.dumps([_ii004_valid_task("DAT-9")]),
        env,
        message="mint colliding DAT-9 on unmerged feature branch",
    )
    _ii004_git(["checkout", "-q", "main"], repo_root, env)

    # From main's own committed HEAD, epic-b/tasks.json does not exist yet:
    # the collision is invisible pre-merge, i.e. never prevented.
    collisions = find_task_id_collisions(repo_root, "DAT", [_ii004_valid_task("DAT-9")])
    assert collisions == []


def test_ii004_cross_branch_duplicate_id_caught_post_hoc_after_merge(tmp_path):
    env = _ii004_hermetic_env(tmp_path)
    repo_root = _ii004_init_repo(tmp_path / "repo", env)
    _ii004_commit_file(
        repo_root,
        "docs/epics/epic-a/tasks.json",
        json.dumps([_ii004_valid_task("DAT-9")]),
        env,
    )

    _ii004_git(["checkout", "-q", "-b", "feature"], repo_root, env)
    _ii004_commit_file(
        repo_root,
        "docs/epics/epic-b/tasks.json",
        json.dumps([_ii004_valid_task("DAT-9")]),
        env,
        message="mint colliding DAT-9 on unmerged feature branch",
    )
    _ii004_git(["checkout", "-q", "main"], repo_root, env)
    _ii004_git(
        ["merge", "-q", "--no-ff", "-m", "merge feature", "feature"], repo_root, env
    )

    collisions = find_task_id_collisions(repo_root, "DAT", [_ii004_valid_task("DAT-9")])

    assert len(collisions) == 1
    record = collisions[0]
    assert record["id"] == "DAT-9"
    assert set(record["paths"]) == {
        "docs/epics/epic-a/tasks.json",
        "docs/epics/epic-b/tasks.json",
    }
