#!/usr/bin/env python3
"""
spec_drift_detector.py — Detects SPEC.md changes during ACT and classifies impact.

Runs as a sidecar during ACT. Polls SPEC.md every 60 seconds.
On drift: writes to state and creates a flag file for the orchestrator.

Usage:
  python3 scripts/spec_drift_detector.py --run-id <id> [--interval 60]
  python3 scripts/spec_drift_detector.py --check-only   # one-shot check, no loop
"""

import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
import time
from datetime import UTC, datetime, timezone
from pathlib import Path

from datum.state import load_state, save_state, update_state

SPEC_FILE = Path("SPEC.md")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256(path.read_bytes()).hexdigest()
    return f"sha256:{h[:16]}"


def classify_impact(old_spec: str, new_spec: str, run_id: str) -> tuple[str, list[str]]:
    """
    Returns (impact_class, affected_lane_ids).
    impact_class: 'scoped' | 'cross_cutting' | 'unknown'
    """
    lane_plan_path = Path(".datum/lane-plan.json")
    if not lane_plan_path.exists():
        return "unknown", []

    with lane_plan_path.open() as f:
        lane_plan = json.load(f)

    # Find lines that changed
    old_lines = set(old_spec.splitlines())
    new_lines = set(new_spec.splitlines())
    changed_lines = old_lines ^ new_lines

    if not changed_lines:
        return "scoped", []

    state = load_state()
    lanes = state.get("lanes", {})
    committed_stages = {"GREEN", "REFACTOR", "completed"}

    affected: list[str] = []
    cross_cutting = False

    for lane_id, lane_info in lane_plan.get("lanes", {}).items():
        # Check if any changed text appears in this lane's AC or files context
        ac_text = " ".join(str(ac) for ac in lane_info.get("acceptance_criteria", []))
        red_note = lane_info.get("red_note", "")
        lane_text = (ac_text + " " + red_note).lower()

        sample_changed = " ".join(sorted(changed_lines)[:5]).lower()
        if any(word in lane_text for word in sample_changed.split() if len(word) > 5):
            affected.append(lane_id)
            # Check if this lane has already committed work
            lane_state = lanes.get(lane_id, {})
            current_stage = lane_state.get("stage", "queued")
            if current_stage in committed_stages:
                cross_cutting = True

    impact = "cross_cutting" if cross_cutting else "scoped"
    return impact, affected


def write_drift_event(
    run_id: str, old_hash: str, new_hash: str, impact: str, affected_lanes: list[str]
) -> None:
    event = {
        "detected_at": datetime.now(UTC).isoformat(),
        "old_hash": old_hash,
        "new_hash": new_hash,
        "impact": impact,
        "affected_lanes": affected_lanes,
        "resolution": "pending",
    }

    def _mutate(state: dict) -> None:
        state.setdefault("spec_drift_events", []).append(event)

    if not update_state(_mutate):
        try:
            save_state({"spec_drift_events": [event]})
        except sqlite3.DatabaseError as exc:
            # The state db is unusable; still emit the orchestrator flag
            # file below so the drift is not lost silently.
            print(json.dumps({"error": "state_db_unwritable", "message": str(exc)}))

    # Signal file for the orchestrator to pick up at next stage boundary
    flag = Path(f".datum/runs/{run_id}/.spec-drift-detected")
    flag.parent.mkdir(parents=True, exist_ok=True)
    flag.write_text(json.dumps(event, indent=2))

    print(
        json.dumps(
            {
                "drift_detected": True,
                "impact": impact,
                "affected_lanes": affected_lanes,
                "old_hash": old_hash,
                "new_hash": new_hash,
            }
        )
    )


def check_once(run_id: str) -> bool:
    """Check for drift once. Returns True if drift detected."""
    if not SPEC_FILE.exists():
        return False

    current_hash = sha256_file(SPEC_FILE)
    state = load_state()
    stored_hash = state.get("spec_hash")

    if not stored_hash:
        # First check — record the hash. Mutating writers go through
        # update_state so a concurrent writer is not clobbered.
        recorded = {
            "spec_hash": current_hash,
            "spec_hash_at": datetime.now(UTC).isoformat(),
        }

        def _record(s: dict) -> None:
            s.update(recorded)

        if not update_state(_record):
            save_state(dict(recorded))
        return False

    if current_hash == stored_hash:
        return False

    # Drift detected — classify impact
    old_spec = ""
    new_spec = SPEC_FILE.read_text()

    # Try to recover old spec content from git

    try:
        result = subprocess.run(
            ["git", "show", "HEAD:SPEC.md"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            old_spec = result.stdout
    except (subprocess.TimeoutExpired, OSError):
        old_spec = ""

    impact, affected = classify_impact(old_spec, new_spec, run_id)
    write_drift_event(run_id, stored_hash, current_hash, impact, affected)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Spec drift detector sidecar")
    parser.add_argument("--run-id", required=True)
    parser.add_argument(
        "--interval", type=int, default=60, help="Poll interval in seconds"
    )
    parser.add_argument(
        "--check-only", action="store_true", help="One-shot check, no loop"
    )
    args = parser.parse_args()

    if args.check_only:
        drifted = check_once(args.run_id)
        sys.exit(1 if drifted else 0)

    print(
        json.dumps(
            {"status": "watching", "interval_s": args.interval, "spec": str(SPEC_FILE)}
        ),
        flush=True,
    )

    while True:
        try:
            check_once(args.run_id)
        except Exception as exc:
            print(json.dumps({"error": str(exc)}), flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
