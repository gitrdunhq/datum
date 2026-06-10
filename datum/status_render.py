#!/usr/bin/env python3
"""
status_render.py — Renders .datum/state.json as a live pipeline view.

Usage:
  python3 scripts/status_render.py
  python3 scripts/status_render.py --json
"""

import argparse
import json
from pathlib import Path

STATE_FILE = Path(".datum/state.json")

STAGE_SYMBOL = {
    "committed": "✓",
    "in_progress": "●",
    "queued": "○",
    "pending": "·",
    "failed": "✗",
    "failed_terminal": "✗",
    "completed": "✓",
}

STAGE_ORDER = ["RED", "GREEN", "REFACTOR"]


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    with STATE_FILE.open() as f:
        return json.load(f)


def render_lane_row(lane_id: str, lane: dict) -> list[str]:
    stage = lane.get("stage", "queued")
    stages = lane.get("stages", {})
    blocked_dep = lane.get("blocked_on_dependency", [])
    blocked_file = lane.get("blocked_on_file_conflict")
    sub_stage = lane.get("sub_stage", "")

    rows = []

    if stage == "queued":
        note = ""
        if blocked_dep:
            note = f"blocked: {', '.join(blocked_dep)} behavior dep"
        elif blocked_file:
            note = f"blocked: file conflict → {blocked_file}"
        else:
            note = "waiting"
        rows.append(f"  {lane_id:<12}   {'queued':<10}                {note}")
        return rows

    if stage == "completed":
        rows.append(f"  {lane_id:<12}                              ✓ complete")
        return rows

    if stage == "failed_terminal":
        rows.append(f"  {lane_id:<12}                              ✗ FAILED (terminal)")
        return rows

    # In-flight lane — show each stage
    first = True
    for s in STAGE_ORDER:
        s_data = stages.get(s, {})
        s_status = s_data.get("status", "pending")
        retries = s_data.get("retries", 0)
        sym = STAGE_SYMBOL.get(s_status, "·")

        note = ""
        if s_status == "in_progress":
            note = f"attempt {retries + 1}"
            if s == "GREEN" and retries > 0:
                note += " (REASONING retry)" if retries >= 1 else ""
        elif s_status == "committed" and s == "RED" and sub_stage == "stub_committed":
            note = "stub committed"
        elif s_status == "committed":
            pass

        prefix = f"  {lane_id:<12}" if first else f"  {'':12}"
        first = False
        rows.append(f"{prefix}── {s:<8} ── {sym} {s_status:<12}── {note}")

    return rows


def detect_fallback_phase() -> str | None:
    import subprocess
    try:
        branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        branch = "unknown"

    root = Path.cwd()
    if (root / "TASKS.md").exists() and (root / "PROPERTIES.md").exists():
        return "Act"
    
    epic_dir = root / "docs" / "epics" / branch
    if epic_dir.exists():
        if (epic_dir / "SPEC.md").exists() and not (root / "TASKS.md").exists():
            return "Plan"
        if (epic_dir / "TICKET.md").exists():
            return "Refine"

    return None


def render(state: dict) -> str:
    if not state:
        fallback = detect_fallback_phase()
        if fallback:
            return f"No active run state. Detected artifacts for phase: {fallback}. Run 'datum go' to start."
        return "No active run. Run 'datum go' to start or 'datum init' to bootstrap."

    run_id = state.get("run_id", "unknown")
    phase = state.get("current_phase", "unknown")
    lanes = state.get("lanes", {})
    in_flight = state.get("in_flight_count", 0)
    cap = state.get("in_flight_cap", 7)
    git = state.get("git", {})
    branch = git.get("work_branch", "?")
    head = git.get("head_sha", "?")[:7] if git.get("head_sha") else "?"
    degraded = state.get("gitnexus_degraded", False)

    completed = sum(1 for lv in lanes.values() if lv.get("stage") == "completed")
    failed = sum(1 for lv in lanes.values() if lv.get("stage") == "failed_terminal")
    total = len(lanes)

    # Header
    lines = [
        f"datum/{run_id}  │  phase: {phase.upper()}  │  {total} lanes  │  {in_flight} in-flight  │  {completed} completed  │  cap: {cap}",
        f"branch: {branch}  head: {head}",
        "",
    ]

    if phase == "act" and lanes:
        lines.append(f"  {'LANE':<12}   {'STAGE':<10}   {'STATUS':<14}   NOTES")
        lines.append("  " + "─" * 62)
        for lane_id in sorted(lanes.keys()):
            lines.extend(render_lane_row(lane_id, lanes[lane_id]))
        lines.append("")

    # Footer
    gitnexus_status = "degraded (grep/AST fallback)" if degraded else "active"
    brief_defects = len(state.get("brief_defects", []))
    pending_flakies = sum(
        1
        for ld in lanes.values()
        for sd in ld.get("stages", {}).values()
        if isinstance(sd, dict) and sd.get("flaky")
    )
    lines.append(
        f"gitnexus: {gitnexus_status}   brief_defects: {brief_defects}   flakies: {pending_flakies}/3"
    )

    if failed:
        lines.append(
            f"⚠  {failed} lane(s) failed terminally — run 'datum status --failures' for details"
        )

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render DATUM pipeline status")
    parser.add_argument("--json", dest="json_out", action="store_true")
    parser.add_argument(
        "--failures",
        action="store_true",
        help="Show only failed lanes with diagnostics",
    )
    args = parser.parse_args()

    state = load_state()

    if args.json_out:
        print(json.dumps(state, indent=2))
        return

    if args.failures:
        lanes = state.get("lanes", {})
        failed = {
            lid: lv for lid, lv in lanes.items() if lv.get("stage") == "failed_terminal"
        }
        if not failed:
            print("No failed lanes.")
            return
        for lid, lv in failed.items():
            print(f"\n{lid}: FAILED")
            for stage, sd in lv.get("stages", {}).items():
                if isinstance(sd, dict) and sd.get("status") in (
                    "failed",
                    "failed_terminal",
                ):
                    print(f"  {stage}: retries={sd.get('retries', 0)}")
        return

    print(render(state))


if __name__ == "__main__":
    main()
