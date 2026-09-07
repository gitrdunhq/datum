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


# ---------------------------------------------------------------------------
# Resume replays EVERY cached agent whose prompt is unchanged — not just the
# boot read. A dogfooding run halted at the Refine gate on 5 unanswered
# questions; the human answered QUESTIONS.md, resumed, and the cached gate
# replayed "5 unanswered" in 18 ms. The fingerprint is therefore over every
# human-editable pipeline input (config, epic docs, pipeline state), and the
# scripts stamp it into every batch prompt.
# ---------------------------------------------------------------------------


def test_fingerprint_changes_when_an_epic_doc_changes(tmp_path):
    repo, home = tmp_path / "repo", tmp_path / "home"
    epic = repo / "docs" / "epics" / "datum" / "x"
    _write(repo / ".datum" / "config.json", {"skills_dir": "/a"})
    (epic).mkdir(parents=True)
    (epic / "QUESTIONS.md").write_text("Q1: ?\n")
    before = config_fingerprint(repo, home, epic_dir=epic)
    (epic / "QUESTIONS.md").write_text("Q1: answered\n")
    after = config_fingerprint(repo, home, epic_dir=epic)
    assert before != after
    # A new doc appearing is a change too.
    (epic / "SPEC.md").write_text("# spec\n")
    assert config_fingerprint(repo, home, epic_dir=epic) != after


def test_fingerprint_changes_when_pipeline_state_changes(tmp_path):
    repo, home = tmp_path / "repo", tmp_path / "home"
    _write(repo / ".datum" / "config.json", {"skills_dir": "/a"})
    before = config_fingerprint(repo, home)
    _write(repo / ".datum" / "pipeline-state.json", {"completedPhases": ["refine"]})
    after = config_fingerprint(repo, home)
    assert before != after


def test_fingerprint_ignores_files_outside_the_epic_dir(tmp_path):
    repo, home = tmp_path / "repo", tmp_path / "home"
    epic = repo / "docs" / "epics" / "datum" / "x"
    epic.mkdir(parents=True)
    before = config_fingerprint(repo, home, epic_dir=epic)
    (repo / "docs" / "epics" / "datum" / "other.md").write_text("noise\n")
    (repo / "README.md").write_text("noise\n")
    assert config_fingerprint(repo, home, epic_dir=epic) == before


def test_cli_hashes_the_current_branch_epic_dir(tmp_path, monkeypatch):
    import subprocess

    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "datum/x"], cwd=repo, check=True)
    subprocess.run(
        ["git", "config", "core.hooksPath", "/dev/null"], cwd=repo, check=True
    )
    subprocess.run(
        ["git", "config", "user.email", "t@example.com"], cwd=repo, check=True
    )
    subprocess.run(["git", "config", "user.name", "T"], cwd=repo, check=True)
    # `git rev-parse --abbrev-ref HEAD` needs a commit to name the branch.
    subprocess.run(
        ["git", "commit", "-q", "--allow-empty", "-m", "init"], cwd=repo, check=True
    )
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path / "home")
    monkeypatch.chdir(repo)
    before = CliRunner().invoke(app, ["config-fingerprint"]).stdout.strip()
    epic = repo / "docs" / "epics" / "datum" / "x"
    epic.mkdir(parents=True)
    (epic / "QUESTIONS.md").write_text("Q1: answered\n")
    after = CliRunner().invoke(app, ["config-fingerprint"]).stdout.strip()
    assert before.startswith("sha256:") and after.startswith("sha256:")
    assert before != after


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
        "configFingerprint": config_fingerprint(repo, home),
        "repoRoot": str(repo.resolve()),
    }


def test_cli_json_carries_the_repo_root_for_the_launch_args(tmp_path, monkeypatch):
    """datum-go applies its `cd` root guard to the boot batch only when the
    launch args carry repoRoot; without it boot ran in whatever directory the
    host spawned the runner in (integration-lanes-2 wf_8e33d186-fb1: exit 126,
    then `cat: .datum/config.json: No such file`). The fingerprint command
    prints both values so one call feeds the launch line."""
    import json

    from datum.cli import app

    (tmp_path / ".datum").mkdir()
    (tmp_path / ".datum" / "config.json").write_text("{}")
    monkeypatch.chdir(tmp_path)
    out = json.loads(CliRunner().invoke(app, ["config-fingerprint", "--json"]).stdout)
    assert out["configFingerprint"].startswith("sha256:")
    assert out["repoRoot"] == str(tmp_path.resolve())
