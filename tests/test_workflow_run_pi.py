"""RED tests for LLM-363: ``datum workflow run`` accepts runtime kind ``pi``.

The CLI tests use a node stub standing in for runner.js (same pattern as
test_workflow_run_cli.py). The end-to-end test runs the real built
skills/runtime/runner.js against a fixture bash stage script; no container,
model or network.
"""

from __future__ import annotations

import json
import shutil
import stat
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app

ROOT = Path(__file__).resolve().parents[1]
MODELS = {"fast": "f", "balanced": "b", "deep": "d"}

FIXTURE_SCRIPT = """#!/usr/bin/env bash
dir="$(dirname "$0")"
printf 'arg0=%s\\narg1=%s\\n' "$1" "$2" >> "$dir/calls.log"
printf '{"text": "{\\\\"ok\\\\": true}"}' > "$(dirname "$2")/reply.json"
exit 0
"""


@pytest.fixture
def repo(tmp_path, monkeypatch):
    from datum import workflow_run

    (tmp_path / ".datum" / "skills").mkdir(parents=True)
    (tmp_path / "pkg-skills").mkdir()
    (tmp_path / ".datum" / "skills" / "fixture.js").write_text(
        'return await agent("hello", { label: "red-1", agentType: "datum-red" })\n'
    )
    (tmp_path / "a.json").write_text('{"runId": "run-1"}')
    stub = tmp_path / "stub-runner.js"
    record = tmp_path / "stub-called"
    stub.write_text(
        f"require('fs').writeFileSync({json.dumps(str(record))}, 'called');\n"
        "process.stdout.write('{\"r\":1}');\n"
    )
    monkeypatch.setattr(workflow_run, "RUNNER_PATH", stub)
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _config(repo: Path, runtime: dict) -> None:
    (repo / ".datum" / "config.json").write_text(
        json.dumps({"skills_dir": str(repo / "pkg-skills"), "runtime": runtime})
    )


def _run():
    return CliRunner().invoke(app, ["workflow", "run", "fixture", "--args", "a.json"])


def test_pi_without_stage_script_exits_2_naming_runtime_stage_script_missing(repo):
    # Catches: pi accepted with no stage_script, or still refused with the old unavailable message
    _config(repo, {"kind": "pi", "models": MODELS})
    result = _run()
    assert result.exit_code == 2, (result.stdout, result.stderr)
    assert "runtime_stage_script_missing" in result.stderr
    assert "runtime_kind_unavailable" not in result.stderr
    assert not (repo / "stub-called").exists(), "runner must not be spawned on a usage error"


def test_pi_with_stage_script_is_no_longer_refused_and_spawns_the_runner(repo):
    # Catches: workflow run still refuses runtime kind pi even when stage_script is set
    _config(repo, {"kind": "pi", "models": MODELS, "stage_script": str(repo / "stage.sh")})
    result = _run()
    assert result.exit_code == 0, (result.stdout, result.stderr)
    assert json.loads(result.stdout) == {"r": 1}
    assert (repo / "stub-called").read_text() == "called"


@pytest.mark.skipif(shutil.which("node") is None or shutil.which("bash") is None, reason="needs node and bash")
def test_real_runner_runs_a_pi_stage_through_the_fixture_script(tmp_path, monkeypatch):
    # Catches: the built runner still throws runtime_kind_unsupported for pi, or never calls the stage script
    (tmp_path / ".datum" / "skills").mkdir(parents=True)
    (tmp_path / "pkg-skills").mkdir()
    wt = tmp_path / "wt"
    wt.mkdir()
    (tmp_path / ".datum" / "skills" / "fixture.js").write_text(
        f'return await agent("hello", {{ label: "red-1", agentType: "datum-red", worktree: {json.dumps(str(wt))} }})\n'
    )
    (tmp_path / "a.json").write_text('{"runId": "run-1"}')
    script = tmp_path / "stage.sh"
    script.write_text(FIXTURE_SCRIPT)
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    _config(tmp_path, {"kind": "pi", "models": MODELS, "stage_script": str(script)})
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(app, ["workflow", "run", "fixture", "--args", "a.json"])

    assert result.exit_code == 0, (result.stdout, result.stderr)
    assert json.loads(result.stdout) == {"ok": True}
    stages = list((tmp_path / ".datum" / "runs" / "run-1" / "stages").iterdir())
    assert len(stages) == 1
    assert stages[0].name.endswith("-red-1")
    recorded = (script.parent / "calls.log").read_text()
    assert recorded == f"arg0={wt}\narg1={stages[0] / 'stage.json'}\n"
