"""The closeout batch (skills/src/shared/lane-steps.ts closeoutCollectSteps /
closeoutArchiveSteps) runs `datum closeout-collect-git`,
`datum closeout-collect-tasks`, `datum closeout-collect-token-metrics`,
`datum closeout-collate` and `datum closeout-archive`. None of those
commands existed: every step failed under `tolerant: true`, closeout-data.json
was never written, and the synthesis agent "correctly refused on missing
data" (eedom run wf_2a5ede48-358) — a consumer with no producer that had
been failing silently since the batch conversion. These tests pin the
commands to the CLI and prove they forward args to the closeout modules.
"""

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app

CLOSEOUT_COMMANDS = [
    "closeout-collect-git",
    "closeout-collect-tasks",
    "closeout-collect-token-metrics",
    "closeout-collate",
    "closeout-archive",
    "closeout-file-followups",
]


@pytest.mark.parametrize("cmd", CLOSEOUT_COMMANDS)
def test_closeout_command_is_registered(cmd):
    result = CliRunner().invoke(app, [cmd, "--help"])
    assert result.exit_code == 0, f"{cmd}: {result.output}"


@pytest.fixture
def repo(tmp_path, monkeypatch):
    r = tmp_path / "repo"
    r.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "datum/x"], cwd=r, check=True)
    subprocess.run(["git", "config", "core.hooksPath", "/dev/null"], cwd=r, check=True)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=r, check=True)
    subprocess.run(["git", "config", "user.name", "T"], cwd=r, check=True)
    (r / "README.md").write_text("hi\n")
    subprocess.run(["git", "add", "README.md"], cwd=r, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=r, check=True)
    (r / ".datum").mkdir()
    (r / ".datum" / "config.json").write_text("{}\n")
    monkeypatch.chdir(r)
    return r


def test_collect_tasks_forwards_args_and_writes_its_raw_file(repo):
    # The collector reads the lane plan and lane-state markers (BUG S), not
    # the retired state.json.
    Path(".datum/lane-plan.json").write_text(
        '{"lanes": {"task-001": {}}, "topological_order": ["task-001"], "total_lanes": 1}\n'
    )
    result = CliRunner().invoke(app, ["closeout-collect-tasks", "--run-id", "r1"])
    assert result.exit_code == 0, result.output
    out = Path(".datum/runs/r1/closeout-raw/tasks.json")
    assert out.is_file()
    assert "total" in json.loads(out.read_text())


def test_archive_forwards_args_and_archives_state(repo):
    # Superseded by AC1/AC2: seed the canonical store via datum.state.save_state
    # and never hand-write .datum/state.json — archive.py must read from
    # datum.state.load_state(), not shutil.copy2 of a stray state.json.
    import datum.state as state_module

    seed = {"phases": {"act": {"status": "completed"}}}
    state_module.save_state(seed)
    write_through = Path(".datum/state.json")
    if write_through.exists():
        write_through.unlink()
    expected = state_module.load_state()

    result = CliRunner().invoke(app, ["closeout-archive", "--run-id", "r1"])
    assert result.exit_code == 0, result.output

    archived = Path(".datum/runs/r1/state.json")
    assert archived.is_file(), (
        "archive.py must write state.json from datum.state.load_state(), "
        "not from a .datum/state.json file that was never created"
    )
    assert json.loads(archived.read_text()) == expected
    assert not Path(".datum/state.json").exists()
    assert not Path(".datum/state.db").exists()


def test_closeout_command_exit_code_is_the_module_exit_code(repo):
    # collect_git requires --base-sha/--merge-sha: argparse exits 2.
    result = CliRunner().invoke(app, ["closeout-collect-git", "--run-id", "r1"])
    assert result.exit_code == 2
