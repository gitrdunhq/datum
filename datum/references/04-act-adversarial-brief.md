# Adversarial Agent Brief Specification

The adversarial agent runs after REFACTOR marks a lane done. Its job is to find inputs the
passing test suite doesn't cover — to defeat the implementation from the outside using only
the properties and public interface, without reading the implementation.

This is distinct from REFACTOR finding missing ACs. REFACTOR reads the code and notices
structural gaps. The adversarial agent tries to construct pathological inputs that violate
stated properties — it doesn't know how the code works, only what it promises.

---

## Context isolation

The adversarial agent has the same isolation rules as RED: it does NOT read the implementation.
It receives only:
- docs/PROPERTIES.md (full — all 11 categories for this task)
- The public type signatures and method contracts (from the stub commit or from the type system)
- The acceptance criteria (from TASKS.md task entry)
- GitNexus context for the public interface (callers, existing tests excluded)

It does NOT receive:
- Implementation source files
- Test source files
- Test results or test runner output
- REFACTOR's commit or commit message

The rationale: seeing the implementation would bias the adversarial agent toward testing what's
there rather than testing what the properties require.

---

## What the adversarial agent produces

A `CandidateEdgeCases` JSON object (see `assets/schemas/candidate-edge-cases.schema.json`):

```json
{
  "contract_version": "1.0",
  "agent_role": "ADVERSARIAL",
  "task_id": "task-001",
  "candidates": [
    {
      "id": "adv-001",
      "property_id": "SAFE-001",
      "description": "startRecording called with permissionGranted=true then immediately called again before first session completes",
      "input_specification": "Two concurrent calls to startRecording() on the same session instance",
      "expected_violation": "Second call should throw SessionAlreadyActive, but the SAFETY property doesn't explicitly cover concurrent invocation",
      "confidence": "medium",
      "verdict": "gap"
    }
  ],
  "no_gaps_found": false,
  "reasoning": "The BOUNDARY property covers single-call constraints but does not address re-entrancy"
}
```

**`verdict` values:**
- `gap` — the adversarial agent believes this is a real untested scenario
- `likely_covered` — the scenario probably exists in the test suite (can't confirm without reading it)
- `out_of_scope` — outside the stated properties for this task

---

## Orchestrator handling of adversarial output

After receiving the adversarial result, REFACTOR reviews the `gap` candidates:

REFACTOR sees the full context (implementation + tests) so it can evaluate each candidate:

1. **Real gap** → REFACTOR signals `missing_ac`; orchestrator spawns new RED-GREEN cycle for that candidate. Adversarial candidate is referenced in the new RED note.
2. **Already covered** → REFACTOR notes the coverage location; candidate is logged as `rejected: covered`.
3. **Not worth testing** → REFACTOR provides reasoning; candidate is logged as `rejected: not_applicable`.

The adversarial candidates and REFACTOR's verdicts are stored in state as `adversarial_review[]`.

---

## Done condition

The adversarial stage is complete when REFACTOR has rendered a verdict on every `gap` candidate.
Lanes with `no_gaps_found: true` skip the REFACTOR review step.

---

## Brief structure

```markdown
## Adversarial Task: <task.id> — <task.title>

### Your role
Find inputs that should fail according to the stated properties but that the current
test suite probably does not cover. You are attacking the spec from the outside.
You do not see the implementation. You do not see the tests.

### Properties you must try to violate
<docs/PROPERTIES.md full entries for this task — all 11 categories if applicable>

### Public interface
<type signatures and method contracts>

### Acceptance criteria
<task.acceptance_criteria>

### What you must NOT do
- Read or reference implementation files
- Read or reference test files
- Produce test code (that is RED's job if a real gap is confirmed)

### Output
A CandidateEdgeCases JSON object. Focus on property violations, boundary
edge cases, ordering violations, and re-entrancy issues — the classes of
bugs that passing happy-path tests routinely miss.
```
