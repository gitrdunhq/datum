#!/usr/bin/env python3
"""Collect task completion metrics from what Act actually produces.

The old collector read `.datum/runs/<run>/state.json` with a `lanes` map —
a producer that was retired, so every closeout died at collate (caliper
BUG S, eedom wf_8240c0f1-6e1). The sources that exist:

  total:      the epic's lane-plan.json (docs/epics/<branch>/lane-plan.json,
              else .datum/lane-plan.json)
  status:     lane-state markers — epic-scoped under
              .datum/epics/<slug>/lane-state/<task>.json (`datum lane-state
              write`), and per-run under .datum/runs/*/lane-state/<task>.json
              (the merge batch's completion markers). Every run directory is
              read, not just this run's: an Act spread over many run ids
              leaves each run's markers in its own directory.

Per-stage retry counts are not tracked by any producer today; the field is
null rather than a fabricated zero.
"""

import json
import re
import subprocess
import sys
from pathlib import Path


def _current_branch() -> str:
    res = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    return res.stdout.strip() if res.returncode == 0 else ""


def _epic_slug(branch: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", branch).strip("-")


def _lane_plan_ids(branch: str) -> list[str] | None:
    candidates = []
    if branch:
        candidates.append(Path("docs/epics") / branch / "lane-plan.json")
    candidates.append(Path(".datum/lane-plan.json"))
    for path in candidates:
        if path.exists():
            try:
                plan = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            lanes = plan.get("lanes") if isinstance(plan, dict) else None
            if isinstance(lanes, dict):
                order = plan.get("topological_order")
                if isinstance(order, list) and set(order) == set(lanes):
                    return [str(x) for x in order]
                return sorted(lanes)
    return None


def _marker_statuses(branch: str) -> dict[str, str]:
    """task_id → status from every lane-state marker for this epic. The
    epic-scoped marker wins over per-run ones; among per-run markers a
    'completed' wins (a lane merged once stays merged)."""
    statuses: dict[str, str] = {}
    runs_root = Path(".datum/runs")
    if runs_root.is_dir():
        for marker in sorted(runs_root.glob("*/lane-state/*.json")):
            data = _read_marker(marker)
            if data is None:
                continue
            task = str(data.get("task_id") or marker.stem)
            status = str(data.get("status") or "")
            if status == "completed" or task not in statuses:
                statuses[task] = status
    if branch:
        epic_dir = Path(".datum/epics") / _epic_slug(branch) / "lane-state"
        if epic_dir.is_dir():
            for marker in sorted(epic_dir.glob("*.json")):
                data = _read_marker(marker)
                if data is None:
                    continue
                task = str(data.get("task_id") or marker.stem)
                statuses[task] = str(data.get("status") or "")
    return statuses


def _read_marker(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.collect-tasks.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    branch = _current_branch()
    plan_ids = _lane_plan_ids(branch)
    statuses = _marker_statuses(branch)
    if plan_ids is None and not statuses:
        print(
            json.dumps(
                {
                    "error": (
                        f"no lane-plan.json for branch {branch or '(unknown)'} "
                        "(docs/epics/<branch>/lane-plan.json or .datum/lane-plan.json) "
                        "and no lane-state markers under .datum/epics/<slug>/lane-state/ "
                        "or .datum/runs/*/lane-state/ — nothing to collect task metrics from"
                    )
                }
            )
        )
        sys.exit(1)

    lane_ids = plan_ids if plan_ids is not None else sorted(statuses)
    for task in sorted(statuses):
        if task not in lane_ids:
            lane_ids.append(task)
    lanes = [
        {"task_id": task, "final_status": statuses.get(task, "not_started")}
        for task in lane_ids
    ]
    total = len(lanes)
    completed = sum(1 for lane in lanes if lane["final_status"] == "completed")
    failed = sum(
        1 for lane in lanes if lane["final_status"] in ("failed", "failed_terminal")
    )
    say_do = completed / total if total else 0

    data = {
        "total": total,
        "completed": completed,
        "failed_terminal": failed,
        "say_do_ratio": round(say_do, 3),
        "per_stage_retries": None,
        "lanes": lanes,
        "source": "lane-plan.json + lane-state markers",
        "brief_defects": [],
        "lane_tools_added": [],
    }

    out = Path(f".datum/runs/{args.run_id}/closeout-raw/tasks.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "data": data}))


if __name__ == "__main__":
    main()
