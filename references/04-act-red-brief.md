# RED Agent Brief Specification

The RED agent's epistemic role is to write a test that proves a property fails without the implementation. Context isolation is enforced by the lane sandbox — the agent cannot read implementation files. Trust the isolation; do not try to work around it.

## What RED receives

Every RED brief contains exactly these sections (no more):

```
docs/epics/$BRANCH/SPEC.md           — full requirements doc
docs/PROPERTIES.md     — filtered to the properties assigned to THIS task only
TASK ENTRY        — the task's title, AC list, files, red_note, introduces_stubs flag
GITNEXUS CONTEXT  — context for each symbol the test will reference (if available)
LANE TOOLS        — contents of scripts/lane-tools/README.md
UPSTREAM STUBS    — signatures from upstream lanes' stub commits (if any dependency)
```

Do NOT include in the brief:
- Implementation files for this task
- Other tasks' GREEN outputs or implementation code
- Any file in the test directory that already exists (RED writes fresh tests)

## What RED produces

### If `introduces_stubs = true`:

**Commit 1 — Stub commit:**

Declare the public types and methods this task introduces, with empty/fatal bodies:
- Swift: `fatalError("not implemented")`
- TypeScript: `throw new Error("not implemented")`
- Go: `panic("not implemented")`
- Python: `raise NotImplementedError`

The stub contains: type declarations, method signatures, and doc comments. No logic.

The stub commit message format:
```
stub(task-001): declare RecordingSession public API

Introduces signature stubs for downstream lanes' RED agents.
Properties: SAFE-001, INV-003
```

**Commit 2 — Test commit:**

Write the failing test against the stubbed signature.

If `introduces_stubs = false`: only one commit (the test).

### Test file requirements

1. Import only from the stub (or from existing code if this task extends existing types)
2. Each test proves exactly one property from the task's docs/PROPERTIES.md assignment
3. The test name or attribute encodes the property ID (e.g., `@Test(.tags(.safe001))` or `func test_SAFE001_noSessionWithoutPermission()`)
4. The test asserts the specific predicate from the property, not a vague "it doesn't crash"

### RED done condition

Test runner returns RED **and** the failure message references the property under test.

If the test is failing for the wrong reason (e.g., compile error unrelated to the missing implementation, or assertion text doesn't reference the property):
- Fix the test so it fails for the right reason
- Do not proceed until the failure message is meaningful

## Stub Protocol rationale

Dependent lanes need RED to compile against types that don't yet exist. Without stubs,
they'd block on GREEN. With stubs, they can start their own RED as soon as the stub commit lands.
The dependency DAG splits: signature-dependency (satisfied by stub) vs behavior-dependency (satisfied by GREEN).
Most lanes only have signature dependencies, so they unlock much sooner.

## Brief invariants the orchestrator must enforce

1. The brief must not contain any file from the test directory
2. The brief must not contain any implementation file for this task
3. GitNexus context is fetched at brief-creation time, not during the agent run
4. docs/PROPERTIES.md is pre-filtered to only the properties assigned to this task

Violating these invariants defeats the epistemic purpose of the RED phase.
