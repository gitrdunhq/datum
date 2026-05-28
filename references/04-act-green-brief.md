# GREEN Agent Brief Specification

The GREEN agent's role is to make the test pass with minimum code. The most important invariant: GREEN never sees test source. This is not a preference — it is what preserves the epistemic value of test-first development. Seeing the test would let GREEN optimize for the test rather than for the property.

## What GREEN receives

```
SPEC.md           — full requirements doc
PROPERTIES.md     — filtered to the properties assigned to THIS task only
TASK ENTRY        — title, AC list, files (the implementation files to write)
GITNEXUS CONTEXT  — context for relevant symbols (if available)
LANE TOOLS        — contents of scripts/lane-tools/README.md
TEST SIGNAL       — redacted output from scripts/test_signal.py (see below)
```

**GREEN does NOT receive:**
- Test source files
- Test file names
- RED agent brief or its commit message
- Any file in the test directory
- The raw test runner output (only the redacted signal)

## The redacted test signal

`scripts/test_signal.py` produces a `TestSignal` JSON object. GREEN receives this JSON, not the raw output:

```json
{
  "status": "fail",
  "assertion_failures": [
    {
      "property_id": "SAFE-001",
      "assertion_message": "Expected startRecording() to throw PermissionDenied, but it returned nil",
      "expected": "PermissionDenied error",
      "actual": "nil"
    }
  ],
  "compile_errors": [
    {
      "kind": "undeclared_identifier",
      "symbol": "RecordingSession",
      "error_code": "E0425",
      "file": "Tests/Unit/RecordingTests.swift",
      "line": 12
    }
  ]
}
```

For compile errors: GREEN receives the symbol name and error kind. This is the minimum to implement the missing type. GREEN does not receive the test line that referenced the symbol.

For assertion failures: GREEN receives the assertion text. This tells it what the implementation must do. It does not tell it how the test is structured.

## What GREEN produces

- Implementation files only. Writing to test files is forbidden and is caught by the lane sandbox.
- Minimum code to make the test pass. Do not add features beyond what the test requires.
- Commit message format:
  ```
  green(task-001): implement RecordingSession.startRecording()
  
  Minimum implementation to satisfy SAFE-001 assertion.
  ```

## Multi-turn behavior (default: up to 3 turns per session)

Before escalating to a new agent, GREEN uses continuation turns on the same thread.
See `references/04-act-green-multiturn.md` for the full protocol.

**Turn 1:** full brief (as defined in this doc)
**Turns 2-N:** continuation prompt only — updated TestSignal + diff, NO re-send of SPEC/PROPERTIES/GitNexus

After `green_max_turns` exhausted on the same thread, escalate to a fresh agent:

Escalation attempt 1: new agent, Reasoning tier, full brief + all prior failure signals
Retry 2: escalate to Reasoning tier + rewritten brief with failure context + verbose failure signal

Same-agent retry is forbidden. Each attempt is a new agent reading a clean brief.

## Fail-closed semantics

If `test_signal.py` returns `{"status": "redaction_failed"}`:
- GREEN receives the `signal_redaction_failed` flag and NO failure detail
- The lane halts
- The orchestrator surfaces: "test_signal.py could not safely redact output — extend the parser"
- This is correct behavior; better to halt than to risk GREEN seeing test source

## Brief invariants the orchestrator must enforce

1. GREEN's brief must not include any read of files under the test directory
2. The test signal must be validated as `TestSignal` schema before inclusion in the brief
3. If `status = "redaction_failed"`, the lane halts before GREEN is dispatched
4. GREEN's file-write permissions in the lane sandbox exclude the test directory
