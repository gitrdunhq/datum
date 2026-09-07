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
import re
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


def test_int_q2_save_state_writes_write_through_json_cache(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state({"run_id": "epic-q2-cache"})

    cache_path = tmp_path / ".datum" / "state.json"
    assert cache_path.exists()
    cached = json.loads(cache_path.read_text())
    assert cached["run_id"] == "epic-q2-cache"


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
