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
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class PipelineStateCorruptError(RuntimeError):
    """.datum/pipeline-state.json exists but could not be read/parsed.

    Must never be treated the same as "no prior state" — a caller that
    does `if not prior_state: start_fresh()` would silently discard
    tracked pipeline progress on file corruption.
    """


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
        # The squash-merge subject is `act(<batchRunId>): merge N lanes`
        # (skills/src/shared/lane-steps.ts mergeSteps) and batchRunId is
        # `<run_id>-b<N>` whenever the epic needed more than one batch — so
        # match the optional batch suffix, or every large epic fails here.
        # Extended regexp: `(`/`)` must be escaped to be literal.
        pattern = rf"^act\({re.escape(run_id)}(-b[0-9]+)?\):"
        result = subprocess.run(
            ["git", "log", "--oneline", "--extended-regexp", "--grep", pattern],
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
    except (json.JSONDecodeError, OSError) as exc:
        raise PipelineStateCorruptError(
            f"{path} exists but could not be parsed as JSON: {exc}"
        ) from exc


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
    final_path = target_dir / "pipeline-state.json"
    tmp_path = target_dir / "pipeline-state.json.tmp"
    tmp_path.write_text(json.dumps(state, indent=2))
    tmp_path.replace(final_path)
    # Mirrored per epic, so a later epic's init never erases this one's
    # progress (elonchesd: epic-2's init blanked epic-1's "act completed"
    # and a fresh datum-go on epic-1 started over at Refine).
    mirror = epic_state_path(branch, target_dir)
    if mirror is not None:
        mirror.parent.mkdir(parents=True, exist_ok=True)
        mirror_tmp = mirror.with_suffix(".json.tmp")
        mirror_tmp.write_text(json.dumps(state, indent=2))
        mirror_tmp.replace(mirror)
    return state


def epic_state_slug(branch: str) -> str:
    """Filesystem-safe slug for an epic branch — the same rule the lane-state
    markers use (.datum/epics/<slug>/), so one epic has one directory."""
    return re.sub(r"[^a-zA-Z0-9]+", "-", branch).strip("-")


def read_epic_pipeline_state(
    branch: str, datum_dir: Path | None = None
) -> dict[str, Any] | None:
    """This epic's own mirrored state, or None when it has none. A mirror
    that exists but cannot be parsed is PipelineStateCorruptError, never
    "no prior state"."""
    target_dir = datum_dir or Path(".datum")
    mirror = epic_state_path(branch, target_dir)
    if mirror is None or not mirror.exists():
        return None
    try:
        candidate = json.loads(mirror.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise PipelineStateCorruptError(
            f"{mirror} exists but could not be parsed as JSON: {exc}"
        ) from exc
    if not isinstance(candidate, dict) or candidate.get("branch") != branch:
        return None
    return candidate


def epic_state_path(branch: str, datum_dir: Path) -> Path | None:
    """The per-epic mirror of pipeline-state.json, or None for a branch that
    yields no usable slug (never resolve a traversal-crafted name)."""
    if not branch or ".." in branch:
        return None
    slug = epic_state_slug(branch)
    if not slug:
        return None
    return datum_dir / "epics" / slug / "pipeline-state.json"


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
    target_dir = datum_dir or Path(".datum")
    # The epic being switched to may have progress of its own in its
    # per-epic mirror: restore it rather than starting it over.
    mirror = epic_state_path(branch, target_dir)
    restored: dict[str, Any] | None = None
    if mirror is not None and mirror.exists():
        try:
            candidate = json.loads(mirror.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            raise PipelineStateCorruptError(
                f"{mirror} exists but could not be parsed as JSON: {exc}"
            ) from exc
        if isinstance(candidate, dict) and candidate.get("branch") == branch:
            restored = candidate
    if restored is not None:
        write_pipeline_state(
            branch=branch,
            run_id=str(restored.get("runId", "")),
            route=str(restored.get("route", prior_state.get("route", ""))),
            completed_phases=list(restored.get("completedPhases", [])),
            current_phase=restored.get("currentPhase"),
            datum_dir=datum_dir,
        )
        return prior_state
    write_pipeline_state(
        branch=branch,
        run_id="",
        route=prior_state.get("route", ""),
        completed_phases=[],
        datum_dir=datum_dir,
    )
    return prior_state
