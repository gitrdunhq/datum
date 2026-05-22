# completed_with_risks — Middle Verdict

`completed_with_risks` is a REFACTOR result status that means: the implementation is coherent
and all acceptance criteria are satisfied, but there are residual concerns the orchestrator
should surface before marking the lane done.

This fills the gap between "fully done" and "missing AC." Currently REFACTOR either passes all
ACs or triggers a new RED-GREEN cycle. `completed_with_risks` lets REFACTOR express a middle
state: "this is good enough to merge, but a human should know about X."

Inspired by Galley's `completed_with_risks` executor verdict.

---

## When to use it

REFACTOR should return `completed_with_risks` (not `done`) when:

- All ACs are satisfied and all tests pass, BUT...
  - A performance bound from PROPERTIES.md is met only marginally (e.g., p95 < 200ms but only just)
  - A thread-safety assumption is made that isn't covered by the test suite
  - A legacy integration point has a known fragility that couldn't be fixed within this task's scope
  - A workaround was used for a missing dependency that should be tracked

REFACTOR should NOT use `completed_with_risks` to avoid doing work. All ACs must still be
satisfied. The risks are informational — they surface in Review, not as blockers.

---

## Risk entry schema

Each risk entry in `executor-result.json`:

```json
{
  "id": "RISK-001",
  "severity": "medium",
  "description": "The retry backoff uses a hardcoded 30s ceiling instead of reading from config.",
  "mitigation": "Config-driven timeout is tracked in follow-ups.json as a low-priority item."
}
```

**Severity:**
- `high` — this risk could cause a production incident if the mitigation fails
- `medium` — notable concern; reviewers should explicitly acknowledge it
- `low` — informational; no expected impact

---

## Orchestrator handling

```
REFACTOR returns done_with_risks
        │
        ├─ All ACs satisfied AND verified_green: true?
        │   YES → proceed; surface risks at Review gate
        │   NO  → treat as `failed`; retry REFACTOR
        │
        ├─ Risks are added to the Review packet for the 'correctness' domain reviewer
        │   High-severity risks appear in REVIEW-REPORT.md as findings
        │
        └─ Risks with severity 'high' halt at Review gate (same as high-severity findings)
           User must explicitly accept before proceeding
```

Risks do NOT block the lane from completing — they surface downstream. This is the key
distinction from a missing AC (which sends the lane back to RED).

---

## In the RETRO

Accumulated risks across all lanes of an epic appear in the Closeout RETRO as an "acknowledged
risks" section. A high count signals that the task decomposition or AC coverage needs improvement.

---

## Example REFACTOR result with risks

```json
{
  "contract_version": "1.0",
  "agent_role": "REFACTOR",
  "task_id": "task-003",
  "status": "done_with_risks",
  "acceptance_criteria": [
    {"id": "AC1", "satisfied": true, "evidence": "RecordingSessionTests.swift:42"},
    {"id": "AC2", "satisfied": true, "evidence": "RecordingSessionTests.swift:67"}
  ],
  "verified_green": true,
  "risks": [
    {
      "id": "RISK-001",
      "severity": "medium",
      "description": "startRecording() is not thread-safe if called concurrently from two queues. The current test suite only tests single-threaded invocation.",
      "mitigation": "Filed as follow-up: add concurrent-invocation property test in next epic."
    }
  ],
  "proof_of_work_path": ".datum/runs/epic-1-.../proof-of-work/task-003.md"
}
```
