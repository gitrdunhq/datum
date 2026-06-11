"""Regression: load_state must not crash on an uninitialized state.db."""

import argparse
import json
import subprocess

import pytest

import datum.state as state_mod


def test_load_state_zero_byte_db(tmp_path, monkeypatch):
    db = tmp_path / "state.db"
    db.touch()  # zero-byte file: exists, but no kv_state table
    monkeypatch.setattr(state_mod, "DB_FILE", db)
    assert state_mod.load_state() == {}


def test_load_state_missing_db(tmp_path, monkeypatch):
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / "absent.db")
    assert state_mod.load_state() == {}


def _init_main_repo(tmp_path):
    """Hermetic git repo on 'main' (a protected branch — the #98 trigger)."""
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "config", "user.email", "t@t"], check=True
    )
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "t"], check=True)
    subprocess.run(
        ["git", "-C", str(tmp_path), "commit", "-q", "--allow-empty", "-m", "init"],
        check=True,
    )


def _git_out(tmp_path, *args):
    return subprocess.run(
        ["git", "-C", str(tmp_path), *args],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def test_cmd_read_does_not_switch_branches(tmp_path, monkeypatch, capsys):
    """Regression for datum#98: `state read` must not create/checkout branches."""
    _init_main_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    head_before = _git_out(tmp_path, "rev-parse", "HEAD")
    branches_before = _git_out(tmp_path, "branch", "--list")

    # Point the module at a repo-local DB and seed real state so cmd_read succeeds
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    state_mod.save_state({"run_id": "epic-98-test"})

    state_mod.cmd_read(argparse.Namespace())

    # Still on main — no branch created, no checkout, HEAD untouched
    assert _git_out(tmp_path, "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert _git_out(tmp_path, "rev-parse", "HEAD") == head_before
    branches_after = _git_out(tmp_path, "branch", "--list")
    assert "datum/epic" not in branches_after
    assert branches_after == branches_before

    # And it still actually reads state
    out = capsys.readouterr().out
    assert json.loads(out)["run_id"] == "epic-98-test"


def test_cmd_read_no_state_errors_without_checkout(tmp_path, monkeypatch, capsys):
    """Negative path: missing state still exits 1 with no_state — and no checkout."""
    _init_main_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    with pytest.raises(SystemExit) as excinfo:
        state_mod.cmd_read(argparse.Namespace())
    assert excinfo.value.code == 1

    out = capsys.readouterr().out
    assert json.loads(out)["error"] == "no_state"

    # No branch created, still on main
    assert _git_out(tmp_path, "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert "datum/epic" not in _git_out(tmp_path, "branch", "--list")
