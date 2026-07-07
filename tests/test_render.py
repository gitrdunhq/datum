"""Tests for datum.render — deterministic report rendering."""

import json

from datum.render import render_closeout_retro


def _write_closeout_data(tmp_path, data: dict):
    path = tmp_path / "closeout-data.json"
    path.write_text(json.dumps(data))
    return path


def test_render_closeout_retro_uses_lane_state_tasks_when_present(tmp_path):
    """When live lane-state produced non-zero task counts, use them as-is —
    the git fallback must not override real data."""
    data = {
        "run_id": "20260707-000000",
        "merge_sha": "abc1234",
        "tasks": {
            "completed": 5,
            "total": 6,
            "failed_terminal": 1,
            "say_do_ratio": 0.833,
        },
        "git": {
            "commit_count": 10,
            "files_touched": ["a.py", "b.py"],
            "loc_net": 42,
            "commits": ["abc1 green(t1): GREEN complete"],
        },
    }
    closeout_data = _write_closeout_data(tmp_path, data)
    output = tmp_path / "RETRO.md"

    render_closeout_retro(closeout_data, output)
    content = output.read_text()

    assert "Tasks completed: 5 / 6" in content
    assert "Derived from git history" not in content


def test_render_closeout_retro_falls_back_to_git_when_tasks_missing(tmp_path):
    """#302: when lane-state produced 0/0 (or is entirely absent), fall back
    to a git-derived proxy using the same commits list the Change Size
    section already consumes, and clearly label it as git-derived."""
    data = {
        "run_id": "20260707-000001",
        "merge_sha": "def5678",
        "tasks": {"completed": 0, "total": 0, "failed_terminal": 0, "say_do_ratio": 0},
        "git": {
            "commit_count": 6,
            "files_touched": ["a.py", "b.py", "c.py"],
            "loc_net": 120,
            "commits": [
                "aaa1111 red(task-1): RED complete",
                "bbb2222 green(task-1): GREEN complete",
                "ccc3333 refactor(task-1): REFACTOR complete",
                "ddd4444 red(task-2): RED complete",
                "eee5555 green(task-2): GREEN complete",
                "fff6666 red(task-3): RED complete",
            ],
        },
    }
    closeout_data = _write_closeout_data(tmp_path, data)
    output = tmp_path / "RETRO.md"

    render_closeout_retro(closeout_data, output)
    content = output.read_text()

    # 2 of 3 tasks reached GREEN -> completed=2, total=3, failed_terminal=1
    assert "Tasks completed: 2 / 3" in content
    assert "Failed terminal lanes: 1" in content
    assert "Derived from git history" in content
    # Change Size section must remain sourced from the real git collector
    # data regardless of the Delivery fallback.
    assert "Commits: 6" in content
    assert "LOC net: 120" in content


def test_render_closeout_retro_reports_zero_zero_when_no_signal_at_all(tmp_path):
    """When neither lane-state nor any lane-convention commits exist, it's
    honest to report 0/0 — there's simply nothing to derive."""
    data = {
        "run_id": "20260707-000002",
        "merge_sha": "ghi9999",
        "tasks": {},
        "git": {"commit_count": 0, "files_touched": [], "loc_net": 0, "commits": []},
    }
    closeout_data = _write_closeout_data(tmp_path, data)
    output = tmp_path / "RETRO.md"

    render_closeout_retro(closeout_data, output)
    content = output.read_text()

    assert "Tasks completed: 0 / 0" in content
