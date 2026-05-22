# Acceptance Skeleton Preflight

Before the first RED agent runs, a skeleton creator agent walks the task's acceptance criteria
and produces the test file structure — describe blocks, test function names, property annotations,
and assertion shape — without any assertions or implementation. RED then fills in the failing
assertions; it does not invent the structure.

This maps each AC ID to a concrete test location before any implementation work begins,
making the AC→test traceability explicit and machine-verifiable.

Inspired by Galley's `preflight.acceptance_skeleton` stage.

---

## What the skeleton creator produces

`scripts/skeleton_creator.py` reads the task entry (ACs, files, red_note, language) and
produces a `preflight-result.json` (see `assets/schemas/preflight-result.schema.json`):

```json
{
  "task_id": "task-001",
  "language": "swift",
  "framework": "xctest",
  "outputs": [
    {
      "ac_id": "AC1",
      "path": "Tests/Unit/Domain/RecordingSessionTests.swift",
      "kind": "xctest",
      "purpose": "Verify permission guard — SAFE-001",
      "property_id": "SAFE-001",
      "skeleton_written": true
    }
  ],
  "no_skeletons_reason": null
}
```

The skeleton file content for Swift/XCTest:

```swift
// Skeleton: task-001 AC1 — SAFE-001
// RED agent: fill in the assertion body below. Do not change the function name.
// The orchestrator links this function name to AC1 in the traceability index.

import Testing
@testable import YourApp

@Suite("RecordingSession — SAFE-001")
struct RecordingSession_SAFE001_Tests {
    @Test(.tags(.safe001), .serialized)
    func permissionGuard_throwsPermissionDenied_whenPermissionNotGranted() async throws {
        // Arrange
        // Act
        // Assert — prove SAFE-001 here
        fatalError("RED agent: fill in this assertion")
    }
}
```

The skeleton uses `fatalError` / `throw Error("skeleton")` / `panic("skeleton")` as the
assertion body so that the file compiles but the test fails immediately — giving RED a clean
compile target with a meaningful failure signal.

---

## When it runs

Skeleton preflight runs per-lane, after Plan and before RED dispatch:

```
lane_plan.json ready
    │
    ├─ For each lane with introduces_stubs = false (and no upstream dependency):
    │   python3 scripts/skeleton_creator.py --task-id <id> --language <lang>
    │   → writes test file skeleton to worktree
    │   → writes preflight-result.json
    │   → annotates each AC with skeleton path
    │
    └─ RED agent receives skeleton path in brief
       RED fills in the assertions (does not invent structure)
```

For lanes with `introduces_stubs = true`, skeleton preflight still runs, but the skeleton
file is written after the stub commit so it can import the declared types.

---

## RED agent brief addition

When skeleton preflight succeeds, the RED brief includes:

```json
{
  "preflight_skeleton": {
    "path": "Tests/Unit/Domain/RecordingSessionTests.swift",
    "ac_id": "AC1",
    "function_name": "permissionGuard_throwsPermissionDenied_whenPermissionNotGranted",
    "property_id": "SAFE-001"
  }
}
```

RED fills in the assertion body. The function name and file path are fixed — RED must not
rename the function or move the file. The traceability index in `preflight-result.json` links
`AC1 → function_name → path`; renaming breaks the link.

---

## Fallback

If `skeleton_creator.py` returns `no_skeletons_reason` (unsupported language/framework,
or a task that is pure refactoring with no new testable surface), the lane proceeds to RED
as normal — RED invents the structure from scratch. The preflight stage is advisory, not blocking.

---

## Traceability index

`preflight-result.json` becomes the AC→test traceability index for this lane. REFACTOR reads it:

```
For each AC in ac_checklist:
  Find the corresponding function_name in preflight-result.json
  Verify that function exists in the test file at the linked path
  If missing → treat as missing AC (log to brief_defects, signal orchestrator)
```

This makes "AC is tested" a structural assertion, not a judgment call.
