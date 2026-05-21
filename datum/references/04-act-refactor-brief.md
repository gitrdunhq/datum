# REFACTOR Agent Brief Specification

REFACTOR is the final agent in the lane. It has full context and is responsible for making the implementation fully correct, clean, and compliant — beyond the bare minimum that GREEN produced. Its one hard constraint: tests are a one-way ratchet.

## What REFACTOR receives

Everything:
```
docs/SPEC.md           — full requirements doc
docs/PROPERTIES.md     — all properties for this task
TASK ENTRY        — full AC list, files, red_note
GITNEXUS CONTEXT  — impact analysis for all files in this lane
LANE TOOLS        — full contents of scripts/lane-tools/README.md
IMPLEMENTATION    — GREEN's implementation (the files in the implementation set)
TEST SOURCE       — the test files (REFACTOR is the first agent that sees these)
TEST RESULTS      — full test runner output (not redacted)
```

## What REFACTOR may do

- Modify the implementation to fully satisfy the SPEC and all ACs (not just the minimum)
- Add error handling, edge case coverage, observability, and logging per SPEC
- Refactor for clarity, layering, and performance per the project's design principles
- Extract or use lane-tools helpers
- Write new lane-tools helpers to `scripts/lane-tools/` (with manifest entry and README update)

## What REFACTOR may NOT do

**Tests are a one-way ratchet.** This is enforced by `test_ratchet.py` pre-commit hook:
- ❌ Remove a test
- ❌ Delete an assertion
- ❌ Weaken an assertion (e.g., `toEqual(x)` → `toBeDefined()`)
- ❌ Skip or disable a test (unless a follow-up issue is filed and referenced in the commit message)

If REFACTOR attempts any of these, the pre-commit hook rejects the commit with a diagnostic. The agent retries with the violation in its brief.

**NO EMBEDDED LANGUAGES.** REFACTOR must never inline raw SQL, GraphQL, HTML, Shell/Bash scripts, or any other secondary language within application code files (e.g. within python/swift files).
- ❌ No raw SQL strings like `cursor.execute("SELECT * FROM users")`
- ❌ No raw shell scripts embedded in strings
- ✅ Always import statements from dedicated `.sql`, `.graphql`, `.sh`, or template files.

**Do not add new tests.** If REFACTOR discovers a missing AC that the current tests don't cover, it must:
1. Log the gap to `brief_defects.json`: `{ "task_id": "task-001", "missing_ac": "...", "surfaced_by_stage": "REFACTOR" }`
2. Signal the orchestrator to spawn a new RED-GREEN cycle for the missing AC
3. NOT write the test itself

This preserves the epistemic value of the RED phase for the missing AC. REFACTOR has already seen the implementation — it cannot write an unbiased failing test.

## Done condition

All tests pass AND:
- Hooks pass (layer boundary, file size, banned patterns, test ratchet)
- Linter reports no violations
- Formatter has no pending changes
- All ACs in the task entry are explicitly checked off

## Commit message format

```
refactor(task-001): full AC coverage for RecordingSession.startRecording()

- Added PermissionDenied error wrapping with structured logging
- Added timeout guard per PERF-002 (3s first-frame deadline)
- Extracted retry logic to lane-tools/retry_with_backoff.py
- All ACs satisfied: [1] permission check, [2] timeout, [3] structured error

Properties proven: SAFE-001, LIVENESS-002, PERF-002
```

## Lane-tools additions

When REFACTOR writes a new helper to `scripts/lane-tools/`:
1. The script lives in `scripts/lane-tools/<name>.py` (or appropriate extension)
2. A manifest entry is added to `scripts/lane-tools/manifest.toml`
3. The README is updated with a one-line description
4. The commit includes all three changes

The pre-commit hook `pre-commit-lane-tools-manifest.sh` rejects commits that add scripts to `lane-tools/` without a manifest entry.

## Proof of Work (required)

Every REFACTOR commit must be accompanied by a proof-of-work file.
See `references/proof-of-work.md` for the required sections.

Write it to: `.datum/runs/<RUN_ID>/proof-of-work/<task_id>.md`
Include `proof_of_work_path` in the result contract.

The orchestrator will reject a `status: done` result without this field.
An empty or copy-pasted proof of work is a brief defect — treat it as a missing AC.

## Brief invariants the orchestrator must enforce

1. REFACTOR's brief includes the test source — this is the only agent that reads it
2. Brief-defects must be written to `.datum/state.json` before REFACTOR signals done
3. If REFACTOR signals "missing AC found", the orchestrator spawns a new RED-GREEN pair before marking the lane complete
