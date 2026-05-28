# Phase: Validate

**Goal:** Confirm the integrated result of all ACT lanes meets the SPEC and PROPERTIES requirements before opening a PR.

## Trigger

Validate runs after the ACT pipeline sync point — all lanes are complete (succeeded or failed terminally).

If any lanes failed terminally, surface their diagnostic packets and ask the user:
- Proceed with remaining lanes' output?
- Retry the failed lanes?
- Halt?

## Steps

### 1. Run the full test suite

Run the project's full test suite against the integrated work branch. This is a holistic run, not per-lane.

Interpret results with `datum test-signal` (for structured output) or directly from the runner.

If any test is RED: halt. Surface the specific failures. Do not open a PR against a red test suite.

### 2. GitNexus risk assessment

If GitNexus available: run `gitnexus detect_changes` on the full PR diff.
- `high` risk: halt; present risk report to user; require explicit approval before proceeding
- `medium` risk: surface risk report; proceed if `validate_human_review = skippable_if_complete` and yolo is active
- `low` risk: log and proceed

If degraded: use heuristic LOC/file threshold. Above threshold → escalate to human. Below → log `risk_unknown, below_threshold`.

### 3. Lint and format check

Run the project's linter and formatter in check mode. If violations exist:
- Auto-fix violations that are scoped to files touched in this epic
- Do NOT auto-fix violations in files not touched by this epic
- Re-run tests after fixing

### 4. AC completeness check

For each task in TASKS.md that completed successfully, verify its acceptance criteria are covered by passing tests. If an AC has no corresponding passing test, surface as a gap (this may become a `brief_defect` if it was REFACTOR's responsibility).

### 5. Gate

Run `datum gate validate [--yolo]`

Validates:
1. Full test suite is green
2. No linter violations in files touched by this epic
3. GitNexus risk is below configured threshold (or human-approved)
4. If `validate_human_review = skippable_if_complete`: LLM judge evaluates; skips if all green

On pass: archive test results, update state, transition to Review.
On fail: surface failures, remain in Validate.

## Outputs

- Confirmed green test suite
- Lint/format clean work branch
- Risk assessment result in state

## Failure modes

- Test RED after ACT sync → halt; surface failures; never open a PR on red
- Linter introduces new violations in existing code → scoped fix only
- GitNexus high risk → halt for human approval (not bypassable in yolo)
