"""Tests for `datum config-fingerprint` (#354).

The datum-go boot agent that reads `.datum/config.json` is replay-cached by
(prompt, opts) on `Workflow({resumeFromRunId})`. The launcher passes this
fingerprint in `args` so it lands in the boot prompt: an unchanged config
still cache-hits, a changed config forces a live re-read.
"""

import json

from typer.testing import CliRunner

from datum.cli import app
from datum.config_fingerprint import config_fingerprint


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def test_fingerprint_is_deterministic_for_same_contents(tmp_path):
    repo, home = tmp_path / "repo", tmp_path / "home"
    _write(repo / ".datum" / "config.json", {"skills_dir": "/a"})
    _write(home / ".datum" / "config.json", {"models": {"fast": "haiku"}})

    assert config_fingerprint(repo, home) == config_fingerprint(repo, home)
    assert config_fingerprint(repo, home).startswith("sha256:")


def test_fingerprint_changes_when_repo_config_changes(tmp_path):
    repo, home = tmp_path / "repo", tmp_path / "home"
    _write(repo / ".datum" / "config.json", {"skills_dir": "/stale"})
    before = config_fingerprint(repo, home)

    _write(repo / ".datum" / "config.json", {"skills_dir": "/fixed"})

    assert config_fingerprint(repo, home) != before


def test_fingerprint_changes_when_global_config_changes(tmp_path):
    repo, home = tmp_path / "repo", tmp_path / "home"
    _write(repo / ".datum" / "config.json", {"skills_dir": "/a"})
    before = config_fingerprint(repo, home)

    _write(home / ".datum" / "config.json", {"models": {"fast": "haiku"}})

    assert config_fingerprint(repo, home) != before


def test_fingerprint_distinguishes_which_file_holds_the_content(tmp_path):
    repo, home = tmp_path / "repo", tmp_path / "home"
    payload = {"skills_dir": "/a"}
    _write(repo / ".datum" / "config.json", payload)
    only_repo = config_fingerprint(repo, home)

    (repo / ".datum" / "config.json").unlink()
    _write(home / ".datum" / "config.json", payload)

    assert config_fingerprint(repo, home) != only_repo


def test_fingerprint_with_no_config_files_still_returns_value(tmp_path):
    fp = config_fingerprint(tmp_path / "repo", tmp_path / "home")
    assert fp.startswith("sha256:")
    assert len(fp) == len("sha256:") + 64


def test_cli_prints_fingerprint_for_cwd(tmp_path, monkeypatch):
    repo, home = tmp_path / "repo", tmp_path / "home"
    _write(repo / ".datum" / "config.json", {"skills_dir": "/a"})
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(home))

    result = CliRunner().invoke(app, ["config-fingerprint"])

    assert result.exit_code == 0, result.output
    assert result.output.strip() == config_fingerprint(repo, home)


def test_cli_json_output(tmp_path, monkeypatch):
    repo, home = tmp_path / "repo", tmp_path / "home"
    _write(repo / ".datum" / "config.json", {"skills_dir": "/a"})
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(home))

    result = CliRunner().invoke(app, ["config-fingerprint", "--json"])

    assert result.exit_code == 0, result.output
    assert json.loads(result.output) == {
        "configFingerprint": config_fingerprint(repo, home)
    }
