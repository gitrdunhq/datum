"""`datum closeout-file-followups`: the follow-up filer was a producer with no
consumer (never registered as a closeout command, never run by the closeout
batch) and read `follow-ups.json` from the cwd while the synthesis agent
writes it under `.datum/runs/<run-id>/`. It now reads that file plus every
per-lane entry the Act phase drops in `.datum/runs/<run-id>/follow-ups/`
(skeptic minority findings, caliper #564), files them idempotently, and
writes the merged manifest back under the run directory.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app


def _item(key: str, title: str = "t") -> dict:
    return {
        "dedup_key": key,
        "title": title,
        "body": "b",
        "severity": "high",
        "category": "other",
        "source": "act.skeptic-minority",
    }


@pytest.fixture
def run_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.chdir(tmp_path)
    d = tmp_path / ".datum" / "runs" / "r1"
    d.mkdir(parents=True)
    return d


def _run(run_id: str = "r1", tracker: str = "local"):
    return subprocess.run(
        [sys.executable, "-m", "datum.closeout.file_followups", "--run-id", run_id, "--tracker", tracker],
        capture_output=True,
        text=True,
    )


def test_registered_as_a_closeout_command():
    res = CliRunner().invoke(app, ["closeout-file-followups", "--help"])
    assert res.exit_code == 0, res.output


def test_merges_synth_manifest_and_per_lane_act_entries_under_the_run_dir(run_dir: Path):
    (run_dir / "follow-ups.json").write_text(json.dumps([_item("synth:1", "from synth")]))
    (run_dir / "follow-ups").mkdir()
    (run_dir / "follow-ups" / "task-007.json").write_text(json.dumps([_item("skeptic-minority:task-007:bc6f34d:0", "serve path drops thresholds")]))
    res = _run()
    assert res.returncode == 0, res.stderr + res.stdout
    out = json.loads(res.stdout)
    assert out["ok"] is True and out["tracker"] == "local"
    assert out["retained"] == 2 and out["filed"] == 0
    merged = json.loads((run_dir / "follow-ups.json").read_text())
    assert sorted(i["dedup_key"] for i in merged) == ["skeptic-minority:task-007:bc6f34d:0", "synth:1"]
    assert (run_dir / ".file-followups.done").exists()


def test_dedup_key_wins_across_sources_and_invalid_items_are_reported_not_dropped(run_dir: Path):
    (run_dir / "follow-ups.json").write_text(json.dumps([_item("k1"), {"title": "no dedup_key"}]))
    (run_dir / "follow-ups").mkdir()
    (run_dir / "follow-ups" / "task-001.json").write_text(json.dumps([_item("k1", "same key again")]))
    res = _run()
    out = json.loads(res.stdout)
    assert out["retained"] == 1
    assert out["invalid"] == 1
    merged = json.loads((run_dir / "follow-ups.json").read_text())
    assert len(merged) == 2  # one valid, one invalid kept for a human


def test_nothing_to_file_is_ok_and_idempotent(run_dir: Path):
    res = _run()
    assert json.loads(res.stdout) == {"ok": True, "filed": 0, "reason": "no follow-ups"}
    res = _run()
    assert json.loads(res.stdout) == {"ok": True, "skipped": True}


def test_medium_and_low_items_are_retained_locally_not_filed_even_with_a_tracker(run_dir: Path, monkeypatch):
    """caliper: keep the tracker quiet — only critical/high open issues;
    medium/low stay in the run manifest and are counted in the output."""
    from datum.closeout import file_followups as mod

    calls: list[list[str]] = []

    def fake_run(cmd, *a, **k):
        calls.append(cmd)

        class R:
            returncode = 0
            stdout = "https://example/issues/1\n"
            stderr = ""

        return R()

    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    items = [
        {**_item("hi", "high one"), "severity": "high"},
        {**_item("crit", "crit one"), "severity": "critical"},
        {**_item("med", "medium one"), "severity": "medium"},
        {**_item("lo", "low one"), "severity": "low"},
    ]
    (run_dir / "follow-ups").mkdir()
    (run_dir / "follow-ups" / "task-006.json").write_text(json.dumps(items))
    import sys as _sys

    monkeypatch.setattr(_sys, "argv", ["file_followups", "--run-id", "r1", "--tracker", "github"])
    import contextlib
    import io

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        mod.main()
    out = json.loads(buf.getvalue())
    assert out["filed"] == 2
    assert out["retained_below_threshold"] == 2
    assert out["min_severity"] == "high"
    assert len([c for c in calls if c[:3] == ["gh", "issue", "create"]]) == 2
    merged = {i["dedup_key"]: i for i in json.loads((run_dir / "follow-ups.json").read_text())}
    assert merged["hi"]["filed_url"] and merged["crit"]["filed_url"]
    assert "filed_url" not in merged["med"] or not merged["med"]["filed_url"]
