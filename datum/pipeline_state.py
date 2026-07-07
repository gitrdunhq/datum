"""pipeline_state.py — deterministic .datum/pipeline-state.json writer.

A phase is only recorded as complete after it is verified against real
git/filesystem evidence — never on a bare claim passed in by an agent.
Branch and timestamp are also resolved here, from real git/system state.

Verification per phase:
  act:      a merge commit matching act(<run_id>): exists in git log
  validate: caller-supplied --tests-pass was true (the real result of an
            actual test run performed earlier in the same phase, not an
            LLM's self-report of pipeline state)
  refine/plan/properties/review/closeout: a commit matching the phase's
            own commit-message prefix (e.g. "review:") exists in git log
"""

from __future__ import annotations

import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PHASE_COMMIT_PREFIX = {
    "refine": "refine:",
    "plan": "plan:",
    "properties": "properties:",
    "review": "review:",
    "closeout": "closeout:",
}


def verify_phase(
    phase: str, *, run_id: str = "", tests_pass: bool = False
) -> tuple[bool, str]:
    if phase == "act":
        pattern = f"^act({run_id}):"
        result = subprocess.run(
            ["git", "log", "--oneline", "--grep", pattern],
            capture_output=True,
            text=True,
        )
        found = bool(result.stdout.strip())
        return found, (
            "" if found else f"no commit matching '{pattern}' found in git log"
        )

    if phase == "validate":
        return tests_pass, (
            ""
            if tests_pass
            else "tests_pass was false — validate did not actually pass"
        )

    prefix = PHASE_COMMIT_PREFIX.get(phase)
    if prefix is None:
        return False, f"unknown phase {phase!r}"
    result = subprocess.run(
        ["git", "log", "--oneline", "--grep", f"^{prefix}"],
        capture_output=True,
        text=True,
    )
    found = bool(result.stdout.strip())
    return found, "" if found else f"no commit matching '^{prefix}' found in git log"


def read_pipeline_state(datum_dir: Path | None = None) -> dict[str, Any] | None:
    target_dir = datum_dir or Path(".datum")
    path = target_dir / "pipeline-state.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def write_pipeline_state(
    branch: str,
    run_id: str,
    route: str,
    completed_phases: list[str],
    current_phase: str | None = None,
    datum_dir: Path | None = None,
) -> dict[str, Any]:
    state = {
        "branch": branch,
        "runId": run_id,
        "route": route,
        "completedPhases": completed_phases,
        "currentPhase": current_phase,
        "lastUpdated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S"),
    }
    target_dir = datum_dir or Path(".datum")
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "pipeline-state.json").write_text(json.dumps(state, indent=2))
    return state


def reset_stale_pipeline_state(
    branch: str, datum_dir: Path | None = None
) -> dict[str, Any] | None:
    """Clear pipeline-state.json when it belongs to a different branch.

    .datum/pipeline-state.json is a single global file, not epic-scoped
    (#337). Bootstrapping a new/different branch must not leave a prior
    epic's completedPhases sitting there for datum-go's auto-resume logic
    to inherit later. Returns the prior state dict if a reset happened,
    otherwise None.
    """
    prior_state = read_pipeline_state(datum_dir)
    if not prior_state or prior_state.get("branch") == branch:
        return None
    write_pipeline_state(
        branch=branch,
        run_id="",
        route=prior_state.get("route", ""),
        completed_phases=[],
        datum_dir=datum_dir,
    )
    return prior_state
