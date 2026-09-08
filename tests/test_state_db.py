"""Regression: load_state must not crash on an uninitialized state.db."""

import argparse
import json
import re
import subprocess
import sys

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


# ── issue #55: descriptive epic branch names ─────────────────────────────


def test_ensure_feature_branch_derives_slug_from_title(tmp_path, monkeypatch, capsys):
    """A title yields datum/<slug>, not generic datum/epic-N."""
    _init_main_repo(tmp_path)
    monkeypatch.chdir(tmp_path)

    branch = state_mod.ensure_feature_branch(
        title="Contact Form: Server-Side Submission!"
    )

    assert branch == "datum/contact-form-server-side-submission"
    assert _git_out(tmp_path, "rev-parse", "--abbrev-ref", "HEAD") == branch


def test_ensure_feature_branch_slug_collision_gets_numeric_suffix(
    tmp_path, monkeypatch, capsys
):
    """Existing datum/<slug> branch → make_unique appends -2."""
    _init_main_repo(tmp_path)
    subprocess.run(
        ["git", "-C", str(tmp_path), "branch", "datum/contact-form"], check=True
    )
    monkeypatch.chdir(tmp_path)

    branch = state_mod.ensure_feature_branch(title="Contact Form")

    assert branch == "datum/contact-form-2"
    assert _git_out(tmp_path, "rev-parse", "--abbrev-ref", "HEAD") == branch


def test_ensure_feature_branch_without_title_falls_back_to_epic_n(
    tmp_path, monkeypatch, capsys
):
    _init_main_repo(tmp_path)
    monkeypatch.chdir(tmp_path)

    branch = state_mod.ensure_feature_branch()

    assert re.fullmatch(r"datum/epic-\d+", branch)
    assert _git_out(tmp_path, "rev-parse", "--abbrev-ref", "HEAD") == branch


def test_ensure_feature_branch_unsluggable_title_falls_back_to_epic_n(
    tmp_path, monkeypatch, capsys
):
    """A title that slugifies to nothing must not produce 'datum/'."""
    _init_main_repo(tmp_path)
    monkeypatch.chdir(tmp_path)

    branch = state_mod.ensure_feature_branch(title="!!! ???")

    assert re.fullmatch(r"datum/epic-\d+", branch)


def test_ensure_feature_branch_noop_when_already_on_feature_branch(
    tmp_path, monkeypatch, capsys
):
    """Title is ignored when not on a protected branch — no new branch."""
    _init_main_repo(tmp_path)
    subprocess.run(
        ["git", "-C", str(tmp_path), "checkout", "-q", "-b", "feature/x"], check=True
    )
    monkeypatch.chdir(tmp_path)

    branch = state_mod.ensure_feature_branch(title="Contact Form")

    assert branch == "feature/x"
    assert "datum/contact-form" not in _git_out(tmp_path, "branch", "--list")


def test_ensure_feature_branch_raises_when_current_branch_is_unknown(
    tmp_path, monkeypatch, capsys
):
    """Regression guard: current_branch() returns None on a git failure
    (timeout, missing binary, detached HEAD, etc — see its bare `except
    Exception: return None`). ensure_feature_branch must never silently
    treat that None as "we're already on a valid non-protected branch"
    and hand a None branch name back to callers (who then write it into
    pipeline state as a real branch)."""
    _init_main_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "current_branch", lambda: None)

    with pytest.raises(RuntimeError, match="branch"):
        state_mod.ensure_feature_branch(title="Contact Form")


def test_cmd_init_without_title_raises_when_current_branch_is_unknown(
    tmp_path, monkeypatch
):
    """Regression guard: without --title, cmd_init derives work_branch as
    `None if branch == base_branch else branch`. If current_branch() can't
    determine the branch (git failure) it also returns None — which this
    formula cannot tell apart from "we're legitimately on main with no
    work branch yet". The unknown-branch case must fail loudly instead of
    silently writing work_branch=None into state.json as if it were a
    normal fresh-epic state."""
    _init_main_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    monkeypatch.setattr(state_mod, "current_branch", lambda: None)

    with pytest.raises(RuntimeError, match="branch"):
        state_mod.cmd_init(argparse.Namespace(run_id=None, title=None))


def test_state_init_title_sets_descriptive_work_branch(tmp_path):
    """amended: superseded by task-012 AC1/AC4 — `datum state init` no
    longer produces a live `.datum/state.json`; the descriptive branch must
    be read back through the canonical `datum state read` accessor instead
    of the legacy write-through cache file."""
    _init_main_repo(tmp_path)

    proc = subprocess.run(
        [sys.executable, "-m", "datum.state", "init", "--title", "Contact Form API"],
        capture_output=True,
        text=True,
        cwd=str(tmp_path),
        timeout=30,
    )
    assert proc.returncode == 0, proc.stderr

    assert _git_out(tmp_path, "rev-parse", "--abbrev-ref", "HEAD") == (
        "datum/contact-form-api"
    )
    assert not (tmp_path / ".datum" / "state.json").exists()

    read_proc = subprocess.run(
        [sys.executable, "-m", "datum.state", "read"],
        capture_output=True,
        text=True,
        cwd=str(tmp_path),
        timeout=30,
    )
    assert read_proc.returncode == 0, read_proc.stderr
    state = json.loads(read_proc.stdout)
    assert state["git"]["work_branch"] == "datum/contact-form-api"


# ── task-012: save_state/update_state stop writing live state.json ────────


def test_save_state_does_not_create_state_json(tmp_path, monkeypatch):
    """AC1: save_state() writes only to .datum/state.db — after
    save_state({...}) in a clean repo, .datum/state.json does not exist."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state({"run_id": "task-012-ac1"})

    assert not (tmp_path / ".datum" / "state.json").exists()
    assert (tmp_path / ".datum" / "state.db").exists()


def test_save_state_does_not_touch_preexisting_state_json(tmp_path, monkeypatch):
    """Negative path: a stale .datum/state.json left over from a legacy run
    must be left byte-for-byte untouched by save_state() — proving the
    write-through no longer fires at all, not merely that it's absent when
    nothing was there to begin with."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    stale_dir = tmp_path / ".datum"
    stale_dir.mkdir(parents=True)
    stale_json = stale_dir / "state.json"
    stale_json.write_text('{"stale": true}')

    state_mod.save_state({"run_id": "task-012-ac1-stale"})

    assert stale_json.read_text() == '{"stale": true}'


def test_update_state_does_not_create_state_json(tmp_path, monkeypatch):
    """AC2: update_state() likewise creates no .datum/state.json, and the
    mutated value round-trips through load_state()."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    state_mod.save_state({"run_id": "task-012-ac2", "in_flight_count": 0})

    def bump(state):
        state["in_flight_count"] += 1

    result = state_mod.update_state(bump)

    assert result is True
    assert not (tmp_path / ".datum" / "state.json").exists()
    assert state_mod.load_state()["in_flight_count"] == 1


def test_load_state_save_state_update_state_signatures_unchanged():
    """AC3: load_state(), save_state() and update_state() keep their exact
    current signatures."""
    import inspect

    assert list(inspect.signature(state_mod.load_state).parameters) == []
    assert list(inspect.signature(state_mod.save_state).parameters) == ["state"]
    assert list(inspect.signature(state_mod.update_state).parameters) == ["mutator"]


def test_cmd_init_end_to_end_creates_no_state_json(tmp_path, monkeypatch):
    """AC4 (behavioural): the init path (which calls save_state internally)
    must leave .datum/state.db as the only artifact — no live
    .datum/state.json — while `datum state read` still resolves state."""
    _init_main_repo(tmp_path)

    init_proc = subprocess.run(
        [sys.executable, "-m", "datum.state", "init"],
        capture_output=True,
        text=True,
        cwd=str(tmp_path),
        timeout=30,
    )
    assert init_proc.returncode == 0, init_proc.stderr
    assert (tmp_path / ".datum" / "state.db").exists()
    assert not (tmp_path / ".datum" / "state.json").exists()

    read_proc = subprocess.run(
        [sys.executable, "-m", "datum.state", "read"],
        capture_output=True,
        text=True,
        cwd=str(tmp_path),
        timeout=30,
    )
    assert read_proc.returncode == 0, read_proc.stderr
    state = json.loads(read_proc.stdout)
    assert state["run_id"].startswith("epic-")
