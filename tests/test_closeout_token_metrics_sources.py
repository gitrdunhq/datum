"""Closeout token metrics have a producer on the hosted path.

Closeout follow-up (run 20261012-150046): six closeouts in a row said
token_metrics no_state_available. Two gaps:

1. collect_token_metrics read metrics.jsonl but still reported
   collected: false with null totals whenever state.db was empty, so even a
   run that had per-call lines said "no data".
2. On the hosted path nothing writes metrics.jsonl: token usage lives only
   in the Workflow tool's transcripts (journal.jsonl plus one agent-*.jsonl
   per subagent). `datum metrics import-workflow` turns those into
   metrics.jsonl lines.

Plan amendments after the plan commit (tasks.json changed again) are brief
defects; collect_brief_defects now reads them from git as well as state.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from typer.testing import CliRunner

from datum.cli import app

ROOT = Path(__file__).resolve().parents[1]
RUN = "20261012-150046"


def _collector(module: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", f"datum.closeout.{module}", "--run-id", RUN],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "PYTHONPATH": str(ROOT), "HOME": str(cwd)},
        check=False,
    )


def _metrics_line(label: str, prompt: int, completion: int, cached: int) -> str:
    return json.dumps(
        {
            "ts": "2026-10-12T15:00:32.071Z",
            "run_id": RUN,
            "label": label,
            "agent_type": "workflow-subagent",
            "model": "m",
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "cached_tokens": cached,
            "prefill_ms": 0,
            "decode_ms": 0,
            "queue_wait_ms": 0,
            "wall_ms": 10,
            "attempt": 1,
            "outcome": "ok",
        }
    )


def test_metrics_jsonl_alone_is_a_collected_source(tmp_path):
    # Catches: per-call lines on disk and the closeout still saying no data.
    run_dir = tmp_path / ".datum" / "runs" / RUN
    run_dir.mkdir(parents=True)
    (run_dir / "metrics.jsonl").write_text(
        _metrics_line("red", 100, 10, 80)
        + "\n"
        + _metrics_line("green", 50, 5, 0)
        + "\n"
    )
    r = _collector("collect_token_metrics", tmp_path)
    assert r.returncode == 0, r.stderr
    data = json.loads((run_dir / "closeout-raw" / "token_metrics.json").read_text())
    assert data["collected"] is True
    assert data["source"] == "metrics.jsonl"
    assert data["total_input"] == 150
    assert data["total_output"] == 15
    assert data["total"] == 165
    assert data["per_stage"]["red"]["cached_tokens"] == 80


def test_no_source_at_all_still_says_so_by_name(tmp_path):
    r = _collector("collect_token_metrics", tmp_path)
    assert r.returncode == 0, r.stderr
    data = json.loads(
        (
            tmp_path / ".datum" / "runs" / RUN / "closeout-raw" / "token_metrics.json"
        ).read_text()
    )
    assert data["collected"] is False
    assert data["status"] == "no_state_available"


# --- import-workflow ------------------------------------------------------


def _workflow_dir(root: Path) -> Path:
    wf = root / "wf_x"
    wf.mkdir()
    (wf / "journal.jsonl").write_text(
        "\n".join(
            json.dumps(e)
            for e in [
                {"type": "launched"},
                {
                    "type": "started",
                    "agentId": "a1",
                    "label": "closeout-collect",
                    "phase": "Collect",
                },
                {"type": "result", "agentId": "a1", "result": "[]"},
                {
                    "type": "started",
                    "agentId": "a2",
                    "label": "synthesize",
                    "phase": "Synthesize",
                },
            ]
        )
        + "\n"
    )

    def turn(ts: str, inp: int, cw: int, cr: int, out: int) -> str:
        return json.dumps(
            {
                "type": "assistant",
                "timestamp": ts,
                "message": {
                    "model": "claude-haiku-5-5",
                    "usage": {
                        "input_tokens": inp,
                        "cache_creation_input_tokens": cw,
                        "cache_read_input_tokens": cr,
                        "output_tokens": out,
                    },
                },
            }
        )

    (wf / "agent-a1.jsonl").write_text(
        json.dumps({"type": "user", "message": {"content": "x"}})
        + "\n"
        + turn("2026-10-12T15:00:00.000Z", 2, 1000, 0, 5)
        + "\n"
        + turn("2026-10-12T15:00:03.500Z", 1, 10, 1000, 20)
        + "\n"
    )
    (wf / "agent-a1.meta.json").write_text(
        json.dumps({"agentType": "datum-cli", "model": "haiku"})
    )
    # a2 started but never finished: recorded as an error with what it used.
    (wf / "agent-a2.jsonl").write_text(
        turn("2026-10-12T15:01:00.000Z", 3, 500, 0, 7) + "\n"
    )
    return wf


def _import(tmp_path: Path, wf: Path):
    cwd = os.getcwd()
    os.chdir(tmp_path)
    try:
        return CliRunner().invoke(
            app, ["metrics", "import-workflow", "--run-id", RUN, str(wf)]
        )
    finally:
        os.chdir(cwd)


def test_import_workflow_writes_one_line_per_subagent(tmp_path):
    wf = _workflow_dir(tmp_path)
    r = _import(tmp_path, wf)
    assert r.exit_code == 0, r.output
    assert json.loads(r.output.strip().splitlines()[-1]) == {
        "ok": True,
        "imported": 2,
        "skipped": 0,
    }
    lines = [
        json.loads(x)
        for x in (tmp_path / ".datum" / "runs" / RUN / "metrics.jsonl")
        .read_text()
        .splitlines()
    ]
    a1, a2 = lines
    assert a1["label"] == "closeout-collect"
    assert a1["agent_type"] == "datum-cli"
    assert a1["model"] == "claude-haiku-5-5"
    # prompt = uncached + cache writes + cache reads, over every turn
    assert a1["prompt_tokens"] == 2 + 1000 + 0 + 1 + 10 + 1000
    assert a1["cached_tokens"] == 1000
    assert a1["completion_tokens"] == 25
    assert a1["wall_ms"] == 3500
    assert a1["outcome"] == "ok"
    assert a1["run_id"] == RUN
    assert a2["label"] == "synthesize"
    assert a2["agent_type"] == ""
    assert a2["outcome"] == "error"
    assert set(a1) == set(json.loads(_metrics_line("x", 0, 0, 0)))


def test_a_message_split_over_several_lines_is_counted_once(tmp_path):
    # Catches: the transcript repeating a message's usage on every content
    # block line, which doubled the prompt count of a real run.
    wf = _workflow_dir(tmp_path)

    def block(out: int) -> str:
        return json.dumps(
            {
                "type": "assistant",
                "timestamp": "2026-10-12T15:00:00.000Z",
                "message": {
                    "id": "msg_1",
                    "model": "m",
                    "usage": {
                        "input_tokens": 1,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 100,
                        "output_tokens": out,
                    },
                },
            }
        )

    (wf / "agent-a1.jsonl").write_text(block(3) + "\n" + block(250) + "\n")
    _import(tmp_path, wf)
    a1 = json.loads(
        (tmp_path / ".datum" / "runs" / RUN / "metrics.jsonl").read_text().splitlines()[0]
    )
    assert a1["prompt_tokens"] == 101
    assert a1["cached_tokens"] == 100
    assert a1["completion_tokens"] == 250


def test_import_workflow_is_idempotent(tmp_path):
    # Catches: a re-run of closeout doubling every token count.
    wf = _workflow_dir(tmp_path)
    _import(tmp_path, wf)
    r = _import(tmp_path, wf)
    assert json.loads(r.output.strip().splitlines()[-1]) == {
        "ok": True,
        "imported": 0,
        "skipped": 2,
    }
    text = (tmp_path / ".datum" / "runs" / RUN / "metrics.jsonl").read_text()
    assert len(text.splitlines()) == 2


def test_import_workflow_refuses_a_dir_without_a_journal(tmp_path):
    r = _import(tmp_path, tmp_path)
    assert r.exit_code == 1
    assert "workflow_journal_missing" in r.output


def test_imported_lines_feed_the_collector(tmp_path):
    wf = _workflow_dir(tmp_path)
    _import(tmp_path, wf)
    r = _collector("collect_token_metrics", tmp_path)
    assert r.returncode == 0, r.stderr
    data = json.loads(
        (
            tmp_path / ".datum" / "runs" / RUN / "closeout-raw" / "token_metrics.json"
        ).read_text()
    )
    assert data["collected"] is True
    assert data["per_agent_type"]["datum-cli"]["calls"] == 1


# --- brief defects from plan amendments -------------------------------------


def _git(args: list[str], cwd: Path) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout


def test_plan_amendment_commits_are_brief_defects(tmp_path):
    # Catches: six lanes' briefs amended by hand and the closeout reporting none.
    _git(["init", "-q", "-b", "claude/epic-x"], tmp_path)
    _git(["config", "user.email", "t@example.com"], tmp_path)
    _git(["config", "user.name", "T"], tmp_path)
    _git(["config", "core.hooksPath", "/dev/null"], tmp_path)
    epic = tmp_path / "docs" / "epics" / "claude" / "epic-x"
    epic.mkdir(parents=True)
    tasks = epic / "tasks.json"
    for i, subject in enumerate(
        [
            "plan: tasks.json + lane-plan.json + TASKS.md",
            "plan: amend DAT-6 to own the source-text pins its change must update",
            "plan: amend DAT-3 and DAT-8 so their RED stages can satisfy their gates",
        ]
    ):
        tasks.write_text(json.dumps({"v": i}))
        _git(["add", "-A"], tmp_path)
        _git(["commit", "-q", "-m", subject], tmp_path)
    r = _collector("collect_brief_defects", tmp_path)
    assert r.returncode == 0, r.stderr
    defects = json.loads(
        (
            tmp_path / ".datum" / "runs" / RUN / "closeout-raw" / "brief_defects.json"
        ).read_text()
    )
    amended = [d for d in defects if d["surfaced_by_stage"] == "plan_amendment"]
    assert [d["task_id"] for d in amended] == ["DAT-6", "DAT-3", "DAT-8"]
    assert all("brief amended after planning in " in d["missing_ac"] for d in amended)
    from datum.models.closeout_data_schema import BriefDefect

    for d in amended:
        BriefDefect(**d)
