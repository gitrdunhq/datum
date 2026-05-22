# Spec Drift Detection

Spec drift occurs when SPEC.md is modified while ACT lanes are actively running. It is the
mid-flight equivalent of scope creep — agents are implementing a spec that no longer matches
what was agreed.

Symphony handles this at the tracker level: if a ticket's state changes mid-run, the worker is
cancelled (`CanceledByReconciliation`). DATUM does the same for SPEC.md changes.

---

## How detection works

At ACT start, the orchestrator hashes SPEC.md and stores it in state:

```json
{ "spec_hash": "sha256:abc123...", "spec_hash_at": "2026-01-01T12:00:00Z" }
```

`scripts/spec_drift_detector.py` runs as a sidecar throughout ACT, polling every 60 seconds.
On each poll it recomputes the hash. If it differs from `spec_hash`:

1. The drift event is written to state: `spec_drift_events[]`
2. The sidecar signals the orchestrator via a flag file: `.datum/runs/<RUN_ID>/.spec-drift-detected`
3. The orchestrator checks this flag at the next stage boundary before dispatching new lanes

---

## Impact classification

When drift is detected, `spec_drift_detector.py` classifies the impact:

**`scoped`** — changes only touch requirements for tasks that are not yet started or are in RED
(test written but no implementation). Affected lanes can be reset to `queued` and re-run
from RED with the updated spec excerpt in their brief. Already-committed GREEN and REFACTOR
stages for other tasks are unaffected.

**`cross_cutting`** — changes affect requirements that are already implemented (lanes in GREEN
or REFACTOR stage, or completed lanes). Reverting and restarting those lanes is expensive.

Classification method: compare the diff of SPEC.md sections against the file-ownership map
in `lane-plan.json`. If the changed sections map only to not-yet-committed lanes → `scoped`.
If they map to already-committed lanes → `cross_cutting`.

---

## Orchestrator response

When the drift flag is detected at a stage boundary:

```
Spec drift detected
        │
        ├─ Impact: scoped
        │   │
        │   └─ Options presented to user:
        │       [1] Reconcile — reset affected lanes to queued; re-run from RED with new spec
        │       [2] Ignore — continue with original spec (record drift as ignored)
        │       [3] Halt — stop pipeline; user will manually revise spec and resume
        │
        └─ Impact: cross_cutting
            │
            └─ Options presented to user:
                [1] Halt and replan — stop pipeline; user revises TASKS.md for the new scope
                [2] Ignore — continue with original spec (strongly discouraged; logged prominently)
                [3] Accept partial — keep completed lanes' output; reset incomplete lanes
```

In `datum yolo` mode: scoped drift auto-reconciles (option 1). Cross-cutting drift always surfaces
to the user regardless of yolo — this is the same logic as GitNexus high-risk-unconfirmed.

---

## State schema additions

```json
{
  "spec_hash": "sha256:...",
  "spec_hash_at": "2026-01-01T12:00:00Z",
  "spec_drift_events": [
    {
      "detected_at": "2026-01-01T13:30:00Z",
      "old_hash": "sha256:abc...",
      "new_hash": "sha256:def...",
      "impact": "scoped",
      "affected_lanes": ["task-003", "task-004"],
      "resolution": "reconciled"
    }
  ]
}
```

---

## What happens to the RETRO

Spec drift events are surfaced in the Closeout RETRO as a signal that the spec quality
at Plan time was insufficient. Repeated drift → Plan phase quality regression follow-up.
