"""RED tests for collect_token_metrics reading .datum/runs/<runId>/metrics.jsonl.

The metrics.jsonl line shape is the exact key set written by the runner sink
(skills/src/runtime/metrics.ts). The collector is run as a module in a
subprocess against a temporary repo; nothing here reads pipeline state.
"""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

RUN_ID = "20261012-050709"
WORKTREE_ROOT = Path(__file__).resolve().parents[1]
TIMEOUT_S = 60


def _line(label, agent_type, prompt, completion, cached, **overrides):
    line = {
        "ts": "2026-10-12T05:07:09.000Z",
        "run_id": RUN_ID,
        "label": label,
        "agent_type": agent_type,
        "model": "qwen-flash",
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "cached_tokens": cached,
        "prefill_ms": 12,
        "decode_ms": 34,
        "queue_wait_ms": 0,
        "wall_ms": 46,
        "attempt": 1,
        "outcome": "ok",
    }
    line.update(overrides)
    return json.dumps(line)


@pytest.fixture
def repo(tmp_path):
    runs_dir = tmp_path / ".datum" / "runs" / RUN_ID
    runs_dir.mkdir(parents=True)
    return {"repo_dir": tmp_path, "runs_dir": runs_dir}


def _write_metrics(repo, lines):
    (repo["runs_dir"] / "metrics.jsonl").write_text("\n".join(lines) + "\n")


def _run_collector(repo):
    return subprocess.run(
        [sys.executable, "-m", "datum.closeout.collect_token_metrics", "--run-id", RUN_ID],
        cwd=repo["repo_dir"],
        capture_output=True,
        text=True,
        timeout=TIMEOUT_S,
        env={**os.environ, "PYTHONPATH": str(WORKTREE_ROOT)},
    )


def _raw(repo):
    path = repo["runs_dir"] / "closeout-raw" / "token_metrics.json"
    return json.loads(path.read_text())


def _base_lines():
    return [
        _line("red:DAT-1", "datum-red", 100, 10, 40),
        _line("green:DAT-1", "datum-green", 0, 0, 0),
    ]


def test_per_agent_type_totals_from_metrics_jsonl(repo):
    """AC1: per-agent-type calls and token totals."""
    _write_metrics(repo, _base_lines())

    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    data = _raw(repo)
    assert data["per_agent_type"]["datum-red"] == {
        "calls": 1,
        "prompt_tokens": 100,
        "completion_tokens": 10,
        "cached_tokens": 40,
    }
    assert data["per_agent_type"]["datum-green"] == {
        "calls": 1,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "cached_tokens": 0,
    }
    assert set(data["per_agent_type"]) == {"datum-red", "datum-green"}


def test_per_agent_type_sums_multiple_calls(repo):
    """AC1: several lines of one agent_type are summed and counted."""
    _write_metrics(
        repo,
        _base_lines() + [_line("red:DAT-2", "datum-red", 50, 5, 10)],
    )

    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert _raw(repo)["per_agent_type"]["datum-red"] == {
        "calls": 2,
        "prompt_tokens": 150,
        "completion_tokens": 15,
        "cached_tokens": 50,
    }


def test_per_stage_keys_are_label_prefixes(repo):
    """AC2: per_stage groups by the text before the first ':' of the label."""
    _write_metrics(
        repo,
        [
            _line("red:DAT-1", "datum-red", 100, 10, 40),
            _line("red:DAT-2:retry", "datum-red", 50, 5, 10),
            _line("green:DAT-1", "datum-green", 7, 3, 2),
            _line("plan", "datum-plan", 20, 2, 0),
        ],
    )

    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert _raw(repo)["per_stage"] == {
        "red": {
            "calls": 2,
            "prompt_tokens": 150,
            "completion_tokens": 15,
            "cached_tokens": 50,
        },
        "green": {
            "calls": 1,
            "prompt_tokens": 7,
            "completion_tokens": 3,
            "cached_tokens": 2,
        },
        "plan": {
            "calls": 1,
            "prompt_tokens": 20,
            "completion_tokens": 2,
            "cached_tokens": 0,
        },
    }


def test_cached_share_rounded_and_zero_when_no_prompt(repo):
    """AC3: cached/prompt per agent type, 4 decimals, 0.0 for zero prompt."""
    _write_metrics(repo, _base_lines())

    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    share = _raw(repo)["cached_share"]
    assert share == {"datum-red": 0.4, "datum-green": 0.0}
    assert isinstance(share["datum-green"], float)


def test_cached_share_rounds_to_four_decimals(repo):
    """AC3: 1 cached of 3 prompt tokens is 0.3333."""
    _write_metrics(repo, [_line("red:DAT-1", "datum-red", 3, 1, 1)])

    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert _raw(repo)["cached_share"] == {"datum-red": 0.3333}


def test_missing_metrics_jsonl_yields_empty_dicts_and_unchanged_status(repo):
    """AC4: no metrics.jsonl -> empty dicts, exit 0, status semantics kept."""
    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    data = _raw(repo)
    assert data["per_agent_type"] == {}
    assert data["per_stage"] == {}
    assert data["cached_share"] == {}
    assert data["status"] == "no_state_available"
    assert data["collected"] is False
    assert data["total"] is None
    assert data["per_phase"] == {}


def test_missing_metrics_jsonl_keeps_db_path_and_per_phase_unchanged(repo):
    """AC4/AC6: a state.db still drives totals and per_phase as before."""
    db_path = repo["runs_dir"] / "state.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE token_metrics "
            "(phase TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER)"
        )
        conn.execute("INSERT INTO token_metrics VALUES ('red', 'm', 1000, 500)")
        conn.execute("INSERT INTO token_metrics VALUES ('green', 'm', 2000, 1000)")
        conn.commit()

    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    data = _raw(repo)
    assert data["collected"] is True
    assert "status" not in data
    assert data["total"] == 4500
    assert data["per_phase"] == {
        "red": {"input": 1000, "output": 500, "models": {"m": {"input": 1000, "output": 500}}},
        "green": {"input": 2000, "output": 1000, "models": {"m": {"input": 2000, "output": 1000}}},
    }
    assert data["per_agent_type"] == {}
    assert data["per_stage"] == {}
    assert data["cached_share"] == {}


def test_db_and_metrics_jsonl_coexist_without_changing_per_phase(repo):
    """AC6: per_phase output is identical whether or not metrics.jsonl exists."""
    db_path = repo["runs_dir"] / "state.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE token_metrics "
            "(phase TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER)"
        )
        conn.execute("INSERT INTO token_metrics VALUES ('red', 'm', 1000, 500)")
        conn.commit()
    _write_metrics(repo, _base_lines())

    result = _run_collector(repo)

    assert result.returncode == 0, f"stderr: {result.stderr}"
    data = _raw(repo)
    assert data["per_phase"] == {
        "red": {"input": 1000, "output": 500, "models": {"m": {"input": 1000, "output": 500}}},
    }
    assert data["total"] == 1500
    assert data["per_agent_type"]["datum-red"]["prompt_tokens"] == 100


def test_malformed_line_exits_nonzero_naming_line_3(repo):
    """AC5: a malformed line 3 fails the collector and names 'line 3'."""
    _write_metrics(
        repo,
        [
            _line("red:DAT-1", "datum-red", 100, 10, 40),
            _line("green:DAT-1", "datum-green", 0, 0, 0),
            "{this is not json",
            _line("red:DAT-2", "datum-red", 5, 1, 0),
        ],
    )

    result = _run_collector(repo)

    assert result.returncode != 0
    assert "line 3" in (result.stderr + result.stdout)
    assert "line 4" not in (result.stderr + result.stdout)
