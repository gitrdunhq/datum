# Brief Builder — Agent Context Construction

A brief is the agent's entire working reality. Context isolation between RED, GREEN, and REFACTOR is not a guideline — it is the mechanism that makes test-first development meaningful. A GREEN agent that sees test source will optimize for the test structure rather than the property. A RED agent that sees the implementation will write tests that fit the code rather than prove the spec.

This doc defines exactly what goes in each brief and how to build it.

---

## Pre-Dispatch Topology Check

Before building **any** brief (RED, GREEN, or REFACTOR), the orchestrator must be able to answer all four invariables for this task's scope. If any are unclear, surface the gap and resolve it before dispatching the agent — not after.

| Invariable | Question | What unclear means |
|---|---|---|
| **State ownership** | Where does the state this task touches live? Who owns it? | Two modules both "own" the same record; ownership is implicit; state is shared without a clear contract |
| **Observability** | Where does feedback live if this task's code misbehaves? | No logs, no metrics, no test signal that would expose a failure in this code path |
| **Blast radius** | What breaks if this task's changes are wrong? | Unknown callers; no GitNexus impact data; files touched by this task are also in-flight in another lane |
| **Timing** | When does this code run relative to dependent operations? | Async boundaries that aren't explicit; ordering assumptions that aren't enforced; race-prone check-then-act patterns |

**If any invariable is unclear:** do not dispatch. Instead, surface the specific gap:
```
Pre-dispatch check failed for task-NNN:
  BLAST RADIUS unclear — gitnexus impact data missing for FileX.
  Resolve before dispatching RED.
```

Run `gitnexus impact <file>` for blast radius. Check state schemas and ownership docs for state invariable. Review async boundaries in the task's file set for timing.

Once all four are answerable, proceed to build the brief below.

---

---

## RED Brief

### Required inputs (fetch before building the brief)

| Input | How to get it | Include how much |
|---|---|---|
| docs/epics/$BRANCH/SPEC.md relevant sections | Read docs/epics/$BRANCH/SPEC.md; extract sections related to this task's ACs | Relevant sections only, not the full doc |
| docs/PROPERTIES.md — task-filtered | Read traceability table; keep only property IDs assigned to this task | Those entries only |
| Task entry | Read TASKS.md task block | Full entry: title, ACs, files, red_note, introduces_stubs, estimated_loc |
| GitNexus context | `gitnexus context <symbol>` for each symbol the test will reference | Full output |
| Lane-tools README | Read `scripts/lane-tools/README.md` | Full content |
| Upstream stub files | For each dependency lane with a stub commit: read the stub file at that commit | Full stub file content |

### Excluded (never include, verify before dispatch)

- Any file matching the test directory pattern (`Tests/`, `__tests__/`, `*_test.*`, `*.spec.*`)
- Implementation source for this task (the files listed in `task.files`)
- Other lanes' outputs (GREEN or REFACTOR commits from concurrent lanes)
- Full docs/PROPERTIES.md (only the task-assigned subset)
- Full TASKS.md (only this task's block)

### Brief structure

```markdown
## Task: <task.id> — <task.title>

### What you are doing
<task.description>

### Acceptance criteria (your test must prove at least one of these)
<task.acceptance_criteria as numbered list>

### Property to prove
<filtered docs/PROPERTIES.md entries — the predicate text, not just the ID>

### RED note
<task.red_note — what the failing test must assert and why it fails>

### Files you will write to
<task.files — test files only; implementation files are not your concern>

### Stub requirement
<if task.introduces_stubs = true>
Emit two commits:
  1. Stub commit — signature declarations only, no logic (fatalError / throw Error / panic / raise NotImplementedError)
  2. Test commit — the failing test, written against the stub

<if task.introduces_stubs = false>
Emit one commit: the failing test.

### Code context
<GitNexus context output for referenced symbols>

### Available lane tools
<scripts/lane-tools/README.md content>

<if upstream stubs exist>
### Upstream stubs (types you may reference)
<stub file content>

### Done condition
The test runner returns RED *and* the failure message references the property predicate.
If the test fails for any other reason (wrong assertion, compile error in unrelated code),
fix the test until the failure is meaningful — do not submit until the reason is right.
```

---

## GREEN Brief

### Required inputs

| Input | How to get it |
|---|---|
| docs/epics/$BRANCH/SPEC.md sections, PROPERTIES (task-filtered), task entry, GitNexus context, lane-tools README | Same as RED |
| TestSignal JSON | `python3 scripts/test_signal.py --framework <detected> --input <runner_log>` |

**Pre-dispatch check:** if `test_signal.py` returns `{"status": "redaction_failed"}`, **halt the lane** — do not dispatch GREEN. Log the halt; surface to user.

### Excluded (verify before dispatch)

- Test source files — **absolute exclusion**. Scan the brief for any path matching the test directory pattern before dispatching.
- Test names
- RED agent brief or commit message
- The raw test runner log (only the `TestSignal` JSON derived from it)

### Brief structure

```markdown
## Task: <task.id> — <task.title>

### What you are doing
Make the test pass. Write only what is needed — no more.

### Acceptance criteria
<task.acceptance_criteria>

### Property being proved
<filtered property predicate>

### Files you will write to (implementation only)
<task.files — the source files, not test files>

### What the test expects (redacted signal)
<TestSignal JSON — assertion_failures, compile_errors, runtime_errors>

For compile errors: the symbol name and error kind tell you what type/method to declare.
For assertion failures: the assertion message and expected/actual values tell you what to implement.
You do not have access to the test source. Work from the signal alone.

### Code context
<GitNexus context>

### Available lane tools
<scripts/lane-tools/README.md>

### Done condition
The test runner returns GREEN (all assertions pass). Do not add new tests.
Do not edit test files — your file permissions exclude the test directory.
```

---

## REFACTOR Brief

### Required inputs

| Input | How to get it |
|---|---|
| docs/epics/$BRANCH/SPEC.md (full), PROPERTIES (task-filtered), task entry | As before |
| GitNexus **impact** (not just context) | `gitnexus impact <file>` for each file in task.files |
| Implementation files at current HEAD | Read from branch |
| Test source files | Read from branch — REFACTOR is the first agent that may see them |
| Full test results | Raw runner output, not redacted |
| Lane-tools README | Full content |
| Brief defects so far | `.datum/state.json` → `brief_defects` for this task |

### Brief structure

```markdown
## Task: <task.id> — <task.title>

### Your role
GREEN shipped the minimum implementation. Your job is to make it fully correct:
full AC coverage, proper error handling, observability, clean architecture, and passing lint.

### Acceptance criteria (checklist — verify each before marking done)
- [ ] AC1: ...
- [ ] AC2: ...

### Properties to hold (all must remain true after your changes)
<full property set for this task>

### Impact analysis
<GitNexus impact output — who calls these files, what blast radius looks like>

### Implementation (current HEAD)
<implementation file content>

### Test source (you may read but not weaken)
<test file content>

### Test results
<full runner output>

### Available lane tools
<scripts/lane-tools/README.md>

### What you may NOT do
- Remove, rename, or disable a test
- Delete or weaken an assertion (test_ratchet.py pre-commit hook will block the commit)
- Add new tests (if you find a missing AC: log it to brief_defects, signal the orchestrator, stop)
- Introduce new external dependencies silently (surface to user instead)

### Lane-tools protocol
If you write a new tool to scripts/lane-tools/:
  1. Add a manifest entry to scripts/lane-tools/manifest.toml
  2. Update scripts/lane-tools/README.md with a one-line description
  3. Commit all three files together (pre-commit hook enforces this)

### Done condition
All tests green. Hooks pass. Linter clean. Formatter clean. Every AC is checked off.
```

---

## Worked Example — Swift task introducing a new type

**Task:** `task-007` — Add `RecordingError.permissionDenied` to the error type hierarchy

**Properties assigned:** `SAFE-001`

**introduces_stubs:** `true`

### Stub commit content

```swift
// Sources/Domain/RecordingError.swift
public enum RecordingError: Error {
    case permissionDenied
    // Implementation: fatalError — stub only for downstream RED agents
}
```

### RED commit content

```swift
// Tests/Unit/Domain/RecordingErrorTests.swift
import Testing
@testable import YourApp

@Test(.tags(.safe001))
func permissionDeniedIsThrowable() throws {
    let session = RecordingSessionStub(permissionGranted: false)
    #expect(throws: RecordingError.permissionDenied) {
        try session.startRecording()
    }
}
```

**TestSignal after RED (what GREEN sees):**
```json
{
  "status": "fail",
  "assertion_failures": [{
    "property_id": "SAFE-001",
    "assertion_message": "Expected RecordingError.permissionDenied to be thrown, got nil",
    "expected": "RecordingError.permissionDenied",
    "actual": "nil"
  }]
}
```

**GREEN implementation (minimum to pass):**
```swift
// Sources/Domain/RecordingError.swift
public enum RecordingError: Error {
    case permissionDenied
}

// Sources/Infrastructure/RecordingSessionImpl.swift
extension RecordingSessionImpl {
    func startRecording() throws {
        guard permissionGranted else { throw RecordingError.permissionDenied }
    }
}
```

**REFACTOR additions:**
- Structured logging on throw
- `LocalizedError` conformance with user-facing message
- Full AC checklist verified
