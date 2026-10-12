"""An operator's agent-types opt-out must survive datum init.

datum init recomputes agent_types from "are the datum-*.md files on disk"
and wrote it over whatever the operator had set. Files on disk do not mean
the running harness loaded them: a Claude Code session started outside the
repo, or before init ran, has no datum-* agent types, and every agentType
call then fails with "agent type 'datum-cli' not found". The act-start batch
runs datum init --json mid-pipeline, so the documented opt-out
(agent_types false) was undone on the next Act (run wf_203ffeff-976).
agent_types_disabled is the operator switch init never rewrites.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app

runner = CliRunner()


def _git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    r = tmp_path / "repo"
    r.mkdir()
    _git("init", "-q", "-b", "main", cwd=r)
    _git("config", "core.hooksPath", "/dev/null", cwd=r)
    _git("config", "user.email", "test@example.com", cwd=r)
    _git("config", "user.name", "Test", cwd=r)
    (r / "README.md").write_text("hello\n")
    _git("add", "README.md", cwd=r)
    _git("commit", "-q", "-m", "initial commit", cwd=r)
    fake_home = tmp_path / "fake_home"
    fake_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: fake_home)
    monkeypatch.chdir(r)
    return r


def _config(r: Path) -> dict:
    return json.loads((r / ".datum" / "config.json").read_text())


def _write_config(r: Path, cfg: dict) -> None:
    (r / ".datum").mkdir(exist_ok=True)
    (r / ".datum" / "config.json").write_text(json.dumps(cfg))


def test_disabled_switch_keeps_agent_types_false_after_init(repo):
    # Catches: init overwriting the operator's opt-out with "files present".
    _write_config(repo, {"agent_types_disabled": True})
    result = runner.invoke(app, ["init", "--json", "--name", "x"])
    assert result.exit_code == 0, result.output
    cfg = _config(repo)
    assert cfg["agent_types"] is False
    assert cfg["agent_types_disabled"] is True


def test_disabled_switch_still_materialises_the_definitions(repo):
    # Catches: the opt-out skipping the copy, which would leave a later
    # session that does load agent types with stale or missing files.
    _write_config(repo, {"agent_types_disabled": True})
    runner.invoke(app, ["init", "--json", "--name", "x"])
    assert (repo / ".claude" / "agents" / "datum-cli.md").is_file()


def test_without_the_switch_init_reports_what_it_installed(repo):
    # Catches: the opt-out logic forcing agent_types false for everyone.
    result = runner.invoke(app, ["init", "--json", "--name", "x"])
    assert result.exit_code == 0, result.output
    cfg = _config(repo)
    assert cfg["agent_types"] is True
    assert "agent_types_disabled" not in cfg
