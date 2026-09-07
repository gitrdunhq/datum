"""`datum lane-spec-export`: the lane's full spec becomes a FILE in the
worktree, and only short fields travel back through the runner.

Echoing the lane JSON through a datum-cli runner is not viable either: the
Haiku runner rewrote every backtick in acceptance criteria as \\` (elonchesd
run wf_47c507cf-1e5, +44/+22 bytes on three lanes), so the byte check
rejected a spec that was correct on disk. Nothing an LLM turn returns is
trusted as content any more. The CLI writes `<wt>/.datum/lane-spec.json`
itself, checks the lane against the digest's spec_hash, and prints one
short JSON line (bytes, blob sha, ac_count) the script can sanity-check.
The RED/GREEN/reflect/skeptic agents read the file by path and evidence
the read with its blob sha.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app
from datum.lane_hash import lane_spec_hash
from datum.lane_spec_export import contract_summary, export_lane_spec

PLAN = {
    "lanes": {
        "task-001": {
            "title": "A — `quoted` §4",
            "files": ["src/a.py", "tests/test_a.py"],
            "reads": [],
            "depends_on": [],
            "acceptance_criteria": [
                "a(input) returns 1 for `§4.1`",
                "a(bad) raises ValueError",
                "print(x) is not a contract",
            ],
            "red_note": "call a() and assert",
            "kind": "behavioral",
            "stage": "queued",
        },
        "task-002": {"title": "B", "files": ["src/b.py"]},
    },
    "topological_order": ["task-001", "task-002"],
    "total_lanes": 2,
}


def _blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


@pytest.fixture
def plan_path(tmp_path: Path) -> Path:
    p = tmp_path / "lane-plan.json"
    p.write_text(json.dumps(PLAN, indent=2, ensure_ascii=False), encoding="utf-8")
    return p


def _run(args: list[str]):
    return CliRunner().invoke(app, ["lane-spec-export", *args])


def test_export_writes_the_lane_file_and_prints_only_short_fields(
    plan_path: Path, tmp_path: Path
):
    out = tmp_path / "wt" / ".datum" / "lane-spec.json"
    expected = lane_spec_hash(PLAN["lanes"]["task-001"])
    res = _run(
        [
            "--plan",
            str(plan_path),
            "--task",
            "task-001",
            "--out",
            str(out),
            "--expect-hash",
            expected,
        ]
    )
    assert res.exit_code == 0, res.output
    assert "\n" not in res.output.strip(), "one JSON line"
    summary = json.loads(res.output)
    data = out.read_bytes()
    assert summary == {
        "task_id": "task-001",
        "path": str(out),
        "bytes": len(data),
        "sha": _blob_sha(data),
        "spec_hash": expected,
        "ac_count": 3,
    }
    # The criteria never travel through stdout — only the file carries them.
    assert "§4.1" not in res.output and "acceptance_criteria" not in res.output
    written = json.loads(data.decode("utf-8"))
    assert written["task_id"] == "task-001"
    assert (
        written["acceptance_criteria"]
        == PLAN["lanes"]["task-001"]["acceptance_criteria"]
    )
    assert written["red_note"] == "call a() and assert"
    assert written["title"] == "A — `quoted` §4"
    assert written["spec_hash"] == expected
    # Backticks and non-ASCII reach the file verbatim (the runner never sees them).
    assert "`§4.1`" in data.decode("utf-8")
    assert data.endswith(b"\n")


def test_export_carries_the_contract_summary_green_reads(
    plan_path: Path, tmp_path: Path
):
    out = tmp_path / "lane-spec.json"
    res = _run(["--plan", str(plan_path), "--task", "task-001", "--out", str(out)])
    assert res.exit_code == 0, res.output
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["contract_summary"] == [
        {
            "function": "a",
            "args": ["input"],
            "returns": "1",
            "raises": None,
            "ac": "a(input) returns 1 for `§4.1`",
        },
        {
            "function": "a",
            "args": ["bad"],
            "returns": None,
            "raises": "ValueError",
            "ac": "a(bad) raises ValueError",
        },
    ]


def test_export_is_idempotent_and_overwrites_a_stale_file(
    plan_path: Path, tmp_path: Path
):
    out = tmp_path / "lane-spec.json"
    out.write_text('{"stale": true}\n', encoding="utf-8")
    first = json.loads(
        _run(["--plan", str(plan_path), "--task", "task-001", "--out", str(out)]).output
    )
    second = json.loads(
        _run(["--plan", str(plan_path), "--task", "task-001", "--out", str(out)]).output
    )
    assert first == second
    assert "stale" not in out.read_text(encoding="utf-8")


def test_hash_mismatch_is_a_named_json_error_exit_1_and_writes_nothing(
    plan_path: Path, tmp_path: Path
):
    out = tmp_path / "lane-spec.json"
    res = _run(
        [
            "--plan",
            str(plan_path),
            "--task",
            "task-001",
            "--out",
            str(out),
            "--expect-hash",
            "fnv1a64:ffffffffffffffff",
        ]
    )
    assert res.exit_code == 1
    err = json.loads(res.output)
    assert err["error"].startswith("lane_spec_hash_mismatch:")
    assert err["spec_hash"] == lane_spec_hash(PLAN["lanes"]["task-001"])
    assert err["expected"] == "fnv1a64:ffffffffffffffff"
    assert not out.exists()


def test_unknown_task_and_bad_plan_are_named_json_errors_exit_1(
    plan_path: Path, tmp_path: Path
):
    out = tmp_path / "lane-spec.json"
    res = _run(["--plan", str(plan_path), "--task", "task-999", "--out", str(out)])
    assert res.exit_code == 1
    assert json.loads(res.output)["error"].startswith("lane_spec_missing: task-999")
    assert not out.exists()

    res = _run(
        ["--plan", str(tmp_path / "nope.json"), "--task", "task-001", "--out", str(out)]
    )
    assert res.exit_code == 1
    assert "nope.json" in json.loads(res.output)["error"]

    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    res = _run(["--plan", str(bad), "--task", "task-001", "--out", str(out)])
    assert res.exit_code == 1
    assert "error" in json.loads(res.output)


def test_unreadable_plan_is_a_named_crash_not_a_traceback(tmp_path: Path):
    # Invalid UTF-8 bytes: json.loads never runs — read_text(encoding="utf-8")
    # raises UnicodeDecodeError, which is not a LaneSpecExportError.
    out = tmp_path / "lane-spec.json"
    garbage = tmp_path / "garbage.json"
    garbage.write_bytes(b"\xff\xfe\x00\x01not utf-8")
    res = _run(["--plan", str(garbage), "--task", "task-001", "--out", str(out)])
    assert res.exit_code == 1
    assert isinstance(
        res.exception, SystemExit
    ), "the crash must be caught and turned into typer.Exit, not re-raised raw"
    payload = json.loads(res.output)
    assert payload["error"].startswith("lane_spec_export_crashed: UnicodeDecodeError")
    assert payload["task_id"] == "task-001"
    assert not out.exists()


def test_named_error_path_is_still_byte_identical(plan_path: Path, tmp_path: Path):
    # The pre-existing LaneSpecExportError branch (lane_spec_missing) must be
    # untouched by the generic-exception handler added alongside it.
    out = tmp_path / "lane-spec.json"
    res = _run(["--plan", str(plan_path), "--task", "task-999", "--out", str(out)])
    assert res.exit_code == 1
    assert json.loads(res.output) == {
        "error": "lane_spec_missing: task-999 is not in the lane plan"
    }
    assert not out.exists()


def test_export_lane_spec_pure_function_reports_bytes_and_blob_sha(tmp_path: Path):
    out = tmp_path / "spec.json"
    summary = export_lane_spec(PLAN, "task-002", out, expect_hash=None)
    data = out.read_bytes()
    assert summary["bytes"] == len(data)
    assert summary["sha"] == _blob_sha(data)
    assert summary["ac_count"] == 0
    assert json.loads(data)["contract_summary"] == []


# ── contract_summary: port of the retired TS extractContractSummary ────────


def test_contract_summary_extracts_name_args_returns_raises():
    (entry,) = contract_summary(["The function frobnicate(x, y) returns a string"])
    assert entry["function"] == "frobnicate"
    assert entry["args"] == ["x", "y"]
    assert entry["returns"] == "string"
    assert entry["raises"] is None


def test_contract_summary_trims_args_and_handles_empty_arg_list():
    assert contract_summary(["function  processData ( a , b , c ) does it"])[0][
        "args"
    ] == ["a", "b", "c"]
    assert contract_summary(["noArgs() does something"])[0]["args"] == []


def test_contract_summary_captures_raises_either_case():
    assert contract_summary(["risky() raises ValueError"])[0]["raises"] == "ValueError"
    assert contract_summary(["dangerous() Raises MyError"])[0]["raises"] == "MyError"


def test_contract_summary_skips_builtins_across_languages():
    funcs = [
        e["function"]
        for e in contract_summary(
            [
                "print('hi')",
                "len(items)",
                "console.log(x)",
                "JSON.stringify(o)",
                "fatalError()",
                "myFunc(x)",
            ]
        )
    ]
    # Same semantics as the retired TS helper: the first call in the text is
    # checked against the skip list, so `JSON.stringify(o)` yields `stringify`.
    assert "myFunc" in funcs
    assert not {"print", "len", "console", "log", "JSON", "fatalError"} & set(funcs)


def test_contract_summary_truncates_ac_to_120_chars_and_tolerates_none():
    long_ac = "myFunction() does something " + "x" * 200
    assert len(contract_summary([long_ac])[0]["ac"]) == 120
    assert contract_summary(None) == []
    assert contract_summary([]) == []


def test_export_task_id_and_spec_hash_win_over_stray_lane_keys(tmp_path: Path):
    plan = {
        "lanes": {
            "task-001": {
                "title": "A",
                "files": [],
                "task_id": "bogus",
                "spec_hash": "bogus",
                "contract_summary": "bogus",
            }
        }
    }
    out = tmp_path / "spec.json"
    summary = export_lane_spec(plan, "task-001", out, expect_hash=None)
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["task_id"] == "task-001" == summary["task_id"]
    assert written["spec_hash"] == summary["spec_hash"] != "bogus"
    assert written["contract_summary"] == []
