"""The post-GREEN caliper gate in agent_loop (issue 84) fails closed.

Every green or refactor episode that reaches `done` runs
`uv run caliper review ... --output <repo>/.datum/caliper_review.json` and
may only finish when caliper exits 0, writes a parseable findings list and
reports no CRITICAL or HIGH finding. Until now the gate had no test of its
own; the suite only stubbed it as a clean run (conftest.caliper_clean).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from datum.agent_loop import agent_loop

CFG = {
    "think_model": "m-big",
    "decide_model": "m-fast",
    "max_steps": 5,
    "timeout_s": 60,
    "allowed_tools": ["read_file", "write_to_file", "run_command"],
    "enable_write_tools": True,
    "allowed_write_dirs": [],
}


def _think(texts):
    it = iter(texts)
    return (
        lambda prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None: {
            "text": next(it),
            "tokens": 10,
            "time_s": 0.1,
        }
    )


def _decide(decisions):
    it = iter(decisions)
    return lambda prompt, model_id, max_time_s=None: {
        "data": next(it),
        "tokens": 5,
        "time_s": 0.05,
    }


def _exec(tool_call, mt_config):
    return "out", False


DONE = {"action": "done", "summary": "finished"}


class Caliper:
    """Scripted stand-in for `uv run caliper review`: one behaviour per call."""

    def __init__(self, monkeypatch, behaviours):
        self.behaviours = list(behaviours)
        self.calls = 0
        real = subprocess.run

        def fake(args, *a, **kw):
            if isinstance(args, (list, tuple)) and list(args[:3]) == [
                "uv",
                "run",
                "caliper",
            ]:
                self.calls += 1
                kind, payload = self.behaviours.pop(0)
                out = Path(list(args)[list(args).index("--output") + 1])
                if kind == "raise":
                    raise OSError(payload)
                if kind == "write":
                    out.write_text(payload)
                    return subprocess.CompletedProcess(list(args), 0, "", "")
                if kind == "exit":
                    return subprocess.CompletedProcess(
                        list(args), payload, "", "caliper said no"
                    )
                if kind == "no-output":
                    return subprocess.CompletedProcess(list(args), 0, "", "")
                raise AssertionError(kind)
            return real(args, *a, **kw)

        monkeypatch.setattr(subprocess, "run", fake)


def _run(phase, thoughts, decisions):
    with (
        patch("datum.agent_loop._think", _think(thoughts)),
        patch("datum.agent_loop._decide", _decide(decisions)),
        patch("datum.agent_loop._execute_tool", _exec),
    ):
        return agent_loop("task", CFG, phase=phase)


@pytest.fixture(autouse=True)
def _in_tmp(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)


def test_a_clean_run_lets_green_finish(monkeypatch):
    # Catches: the gate blocking a clean completion.
    cal = Caliper(monkeypatch, [("write", "[]")])
    r = _run("act_green", ["done"], [DONE])
    assert cal.calls == 1
    assert r["escalated"] is False
    assert r["result"]["summary"] == "finished"


def test_a_non_zero_exit_escalates_as_a_verification_failure(monkeypatch):
    # Catches: a broken or missing caliper being read as a pass.
    Caliper(monkeypatch, [("exit", 2)])
    r = _run("act_green", ["done"], [DONE])
    assert r["escalated"] is True
    assert r["reason"].startswith("caliper_gate_failed: exit 2")
    assert r["layer"] == "verification"


def test_a_spawn_error_escalates_as_crashed(monkeypatch):
    # Catches: an exception from the spawn escaping the loop.
    Caliper(monkeypatch, [("raise", "no such file: uv")])
    r = _run("act_green", ["done"], [DONE])
    assert r["escalated"] is True
    assert r["reason"].startswith("caliper_gate_crashed:")
    assert "no such file: uv" in r["reason"]


def test_exit_zero_without_an_output_file_fails_closed(monkeypatch):
    # Catches: "exited 0" alone counting as a clean review.
    Caliper(monkeypatch, [("no-output", None)])
    r = _run("act_green", ["done"], [DONE])
    assert r["escalated"] is True
    assert r["reason"] == "caliper_gate_failed: missing output file (fail closed)"


def test_unparseable_output_fails_closed(monkeypatch):
    # Catches: a truncated findings file read as no findings.
    Caliper(monkeypatch, [("write", "[{not json")])
    r = _run("act_green", ["done"], [DONE])
    assert r["escalated"] is True
    assert r["reason"].startswith("caliper_gate_failed: invalid json output:")


def test_a_high_finding_rejects_done_and_the_next_clean_review_lets_it_finish(
    monkeypatch,
):
    # Catches: a HIGH finding ignored, or treated as terminal instead of
    # being fed back for a fix.
    high = json.dumps(
        [
            {
                "severity": "HIGH",
                "plugin": "gitleaks",
                "message": "token in source",
                "file": "a.py",
                "line": 3,
            }
        ]
    )
    cal = Caliper(monkeypatch, [("write", high), ("write", "[]")])
    r = _run("act_green", ["done", "done again"], [DONE, DONE])
    assert cal.calls == 2
    assert r["escalated"] is False
    rejected = [
        s
        for s in r["steps"]
        if "CALIPER REVIEW REJECTED COMPLETION" in str(s.get("observation", ""))
    ]
    assert len(rejected) == 1
    assert "[HIGH] gitleaks: token in source" in rejected[0]["observation"]
    assert "File: a.py:3" in rejected[0]["observation"]


def test_medium_and_low_findings_do_not_block(monkeypatch):
    # Catches: the severity filter blocking on anything below HIGH.
    findings = json.dumps(
        [
            {"severity": "medium", "plugin": "complexity", "message": "long"},
            {"severity": "LOW", "plugin": "x", "message": "y"},
        ]
    )
    Caliper(monkeypatch, [("write", findings)])
    r = _run("act_green", ["done"], [DONE])
    assert r["escalated"] is False


def test_the_gate_only_runs_for_green_and_refactor(monkeypatch):
    # Catches: RED or analysis phases paying for (or failing on) caliper.
    cal = Caliper(monkeypatch, [])
    r = _run("act_red", ["done"], [DONE])
    assert cal.calls == 0
    assert r["escalated"] is False
