"""Run event log: the producer `datum retrospect` reads (#520).

One JSON line per event in `.datum/runs/<run_id>/events.jsonl`. Two
producers, both deterministic CLI steps of the Workflow pipeline:

- `datum events lane` — one line per lane outcome, called by datum-go after
  Act (skills/src/shared/events-steps.ts).
- `datum pipeline-state-save` — one `phase_complete` line per phase, with
  the duration since the previous phase record when it is known.

The lane event's `payload.reason` is the error's named prefix (the text
before the first colon), which is what retrospect groups recurring
patterns by, and `payload.failure_layer` is FailureLayer.from_reason() of
that prefix.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path

from datum.failure_layer import FailureLayer

_BATCH_SUFFIX = re.compile(r"-b\d+$")


def base_run_id(run_id: str) -> str:
    """`<run>-b3` (an Act batch) belongs to run `<run>`."""
    return _BATCH_SUFFIX.sub("", run_id)


def events_path(run_id: str) -> Path:
    return Path(".datum") / "runs" / base_run_id(run_id) / "events.jsonl"


def reason_prefix(error: str | None) -> str | None:
    if not error:
        return None
    head = error.split(":", 1)[0].strip()
    return head or None


def _append(run_id: str, event: dict) -> Path:
    path = events_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, sort_keys=True) + "\n")
    return path


def _base_event(
    run_id: str, phase: str, event_type: str, status: str, message: str
) -> dict:
    return {
        "event_id": f"evt-{uuid.uuid4().hex[:12]}",
        "timestamp": time.time(),
        "run_id": base_run_id(run_id),
        "task_id": None,
        "agent_id": "datum-go",
        "role": "orchestrator",
        "phase": phase,
        "event_type": event_type,
        "status": status,
        "severity": "error" if status == "failed" else "info",
        "message": message,
        "payload": {},
    }


def append_lane_event(
    run_id: str, task_id: str, status: str, stage: str | None, error: str | None
) -> Path:
    """Record one lane outcome. `blocked` and `skipped` lanes are failures
    for retrospect's purposes (they did not land); the lane's own status is
    kept in the payload."""
    failed = status != "completed"
    event = _base_event(
        run_id,
        "act",
        "lane_outcome",
        "failed" if failed else "completed",
        error or f"{task_id} {status}",
    )
    event["task_id"] = task_id
    event["payload"] = {"lane_status": status, "stage": stage or "UNKNOWN"}
    prefix = reason_prefix(error)
    if failed and prefix:
        event["payload"]["reason"] = prefix
        event["payload"]["failure_layer"] = FailureLayer.from_reason(prefix).value
    return _append(run_id, event)


def append_phase_event(run_id: str, phase: str, duration_s: float | None) -> Path:
    event = _base_event(
        run_id, phase, "phase_complete", "completed", f"{phase} complete"
    )
    if isinstance(duration_s, (int, float)):
        event["payload"]["duration_s"] = float(duration_s)
    return _append(run_id, event)
