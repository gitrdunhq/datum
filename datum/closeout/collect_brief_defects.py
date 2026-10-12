#!/usr/bin/env python3
"""Collect brief defects surfaced during ACT.

Two sources: the run state's brief_defects list, and the epic's own git
history. Every commit that changes the epic's tasks.json after the one that
created it is a plan amendment: a lane brief that could not be executed as
written (closeout follow-up, run 20261012-150046: six lanes amended by hand,
brief_defects reported empty).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

from datum.closeout.state_source import load_run_state
from datum.path_utils import closeout_raw_dir, collector_marker
from datum.run_ids import run_id_arg

LANE_ID_RE = re.compile(r"\b(?:[A-Z][A-Z0-9]*-\d+|task-\d+)\b")


def _epic_dir() -> Path | None:
    branch = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    if not branch or branch == "HEAD":
        return None
    pattern = "docs/epics/{branch}"
    config = Path(".datum/config.json")
    if config.is_file():
        try:
            pattern = json.loads(config.read_text()).get("epic_dir_pattern") or pattern
        except (json.JSONDecodeError, OSError):
            pass
    return Path(pattern.replace("{branch}", branch))


def plan_amendments() -> list[dict]:
    """One defect per lane named in each commit that changed tasks.json after
    the commit that created it, in collate's BriefDefect shape."""
    epic = _epic_dir()
    if epic is None:
        return []
    log = subprocess.run(
        [
            "git",
            "log",
            "--reverse",
            "--format=%h%x09%s",
            "--",
            str(epic / "tasks.json"),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if log.returncode != 0:
        return []
    rows = [line.split("\t", 1) for line in log.stdout.splitlines() if "\t" in line]
    defects: list[dict] = []
    for sha, subject in rows[1:]:
        lanes = list(dict.fromkeys(LANE_ID_RE.findall(subject))) or ["unknown"]
        for lane in lanes:
            defects.append(
                {
                    "task_id": lane,
                    "missing_ac": f"brief amended after planning in {sha}: {subject}",
                    "surfaced_by_stage": "plan_amendment",
                }
            )
    return defects


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", type=run_id_arg, required=True)
    args = parser.parse_args()

    marker = collector_marker(args.run_id, "brief-defects")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    state, state_source = load_run_state(args.run_id)
    defects = list(state.get("brief_defects", []))
    defects.extend(plan_amendments())

    out = closeout_raw_dir(args.run_id) / "brief_defects.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(defects, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "count": len(defects)}))


if __name__ == "__main__":
    main()
