# SPEC: Fail-Fast Deterministic Validation Before Tests

## Summary

Add a deterministic ruff + mypy pre-check step inside `runLane` in `skills/src/datum-tdd-act-lane.ts` that runs after the GREEN agent writes implementation files but before pytest executes. The checks are sub-second, produce structured error output, and feed directly back into the GREEN retry loop — eliminating a full pytest round-trip for ~40% of failures (syntax errors, bad imports, type mismatches).

## Context

`runLane` (lines 88–363, `skills/src/datum-tdd-act-lane.ts`) orchestrates the RED → GREEN → REFACTOR saga per lane. The insertion point is inside the GREEN phase, between the first `agent()` call that writes implementation code (line 290) and the commit/pytest gate (lines 299–313). The file list required by ruff and mypy is already available as `implFiles`, derived from `classifyFiles()` in `skills/src/shared/utils.ts` (lines 81–104) at line 97 of the lane function.

The sandbox environment exposes no bare subprocess/exec global. All deterministic shell operations in the codebase — git diff checks (lines 59–63), grep count checks (lines 173–177), ast-grep structural checks (lines 186–208) — are performed via the `agent()` global with a prompt pattern of `"Run: <command>\nReturn ONLY ..."`. The ruff and mypy pre-checks must follow this identical pattern.

`LaneOutcome` (defined in `skills/src/shared/types.ts`, lines 87–92) already carries a free-form `error?: string` field. Existing error strings use a `<prefix>: <detail>` convention (`green_blindness_violation:`, `file_ownership_violation:`, `placeholder_assertions:`, `no_new_tests_written:`). The new checks encode their identity in this field (`ruff_lint_error:`, `mypy_type_error:`) without requiring a schema change to `LaneOutcome` or `FailureStage`.

The GREEN retry escalation at lines 299–308 escalates from `balanced` (sonnet) to `deep` (opus) on first failure. The ruff/mypy errors must be injected into the retry context (the `failure_reason` / `greenRetryPacketStr`) so the GREEN retry agent receives structured line-number-and-error-code feedback rather than a generic "tests failed" signal.

## Requirements

### REQ-1: Ruff lint check after GREEN writes, before pytest

After the first GREEN `agent()` call returns at line 290 (and `green.success` is truthy), run:

```
ruff check --output-format=json <implFiles>
```

via `agent()` with prompt pattern matching the existing deterministic-check pattern. Parse the JSON output with `parseAgentJson`. If ruff exits with errors (violations array is non-empty), the check fails.

**AC-1a**: When ruff finds zero violations, the lane continues to the mypy check (REQ-2) without calling pytest.  
**AC-1b**: When ruff finds one or more violations, the lane does NOT call pytest and instead passes the structured error list (file, line, col, code, message) as `failure_reason` context into the GREEN retry (REQ-3).  
**AC-1c**: When `implFiles` is empty, the ruff check is skipped and the lane proceeds to mypy (or pytest if mypy is also skipped).

### REQ-2: Mypy type check after ruff passes, before pytest

After ruff passes (REQ-1), run:

```
mypy --no-error-summary <implFiles>
```

via `agent()` with the same deterministic prompt pattern. If mypy exits with type errors, the check fails.

**AC-2a**: When mypy reports zero type errors, the lane proceeds to the existing pytest verification gate at lines 299–313.  
**AC-2b**: When mypy reports type errors, the lane does NOT call pytest and instead passes structured mypy error output (file, line, message) as `failure_reason` context into the GREEN retry (REQ-3).  
**AC-2c**: Mypy warnings that are not errors (non-zero exit but no `error:` lines) do not block progression.  
**AC-2d**: When `implFiles` is empty, the mypy check is skipped.

### REQ-3: Structured error passback into GREEN retry

When ruff or mypy fails, the structured error output is injected into the GREEN retry context before calling `greenRetryPrompt`. The `greenRetryPacketStr` passed to the retry agent includes the pre-check errors so the agent can fix them without running pytest.

**AC-3a**: The `failure_reason` string passed to the retry contains: which tool failed (`ruff` or `mypy`), the file path(s), line number(s), error code(s) (for ruff) or message(s) (for mypy).  
**AC-3b**: The retry uses model tier `deep` (opus) on first ruff/mypy failure — the same escalation behavior as the existing test-failure retry path (line 301).  
**AC-3c**: After the GREEN retry returns, the ruff + mypy pre-checks run again before pytest is attempted (the pre-check gate is not bypassed on retry).

### REQ-4: Fail-fast ordering enforced

The full check sequence for each GREEN attempt is: ruff → mypy → pytest. No step is reached if the prior step fails.

**AC-4a**: If ruff fails, mypy is not called and pytest is not called.  
**AC-4b**: If ruff passes and mypy fails, pytest is not called.  
**AC-4c**: If ruff and mypy both pass, pytest runs unchanged per the existing gate.

### REQ-5: LaneOutcome encodes which check caught the failure

When the lane ultimately fails in the GREEN stage due to a pre-check (after both the first attempt and the retry have failed the pre-check), the returned `LaneOutcome.error` string uses the established naming convention to identify the catching tool.

**AC-5a**: A ruff failure that exhausts retries produces `LaneOutcome.error` starting with `ruff_lint_error:`.  
**AC-5b**: A mypy failure that exhausts retries produces `LaneOutcome.error` starting with `mypy_type_error:`.  
**AC-5c**: The `stage` field remains `'GREEN'` for all pre-check failures (not a new FailureStage value).

### REQ-6: RED phase is not modified

No ruff or mypy checks are added to the RED phase. RED tests are expected to fail; linting them would produce false failures for files that intentionally import not-yet-written symbols.

**AC-6a**: The `runRefactor` function (lines 367–426) is not modified.  
**AC-6b**: No changes are made to any file outside `skills/src/datum-tdd-act-lane.ts` and `skills/src/shared/types.ts` (if `LaneOutcome` schema changes are needed — otherwise only the lane file changes).

### REQ-7: Generated JS is rebuilt after TS changes

`skills/datum-tdd-act-lane.js` is a generated file. After editing `skills/src/datum-tdd-act-lane.ts`, the build step must be run.

**AC-7a**: `bash scripts/build-workflows.sh` completes without error after the TS edit.  
**AC-7b**: `skills/datum-tdd-act-lane.js` contains the new ruff/mypy check logic.

## Failure Modes

| Failure | Handling |
|---|---|
| `ruff` not found in PATH inside agent sandbox | `agent()` returns an error string; parse as zero violations (skip ruff, log a warning, proceed to mypy). Do not fail the lane on tool-not-found. |
| `mypy` not found in PATH | Same as ruff-not-found: skip mypy, log warning, proceed to pytest. |
| ruff output is not valid JSON (e.g. ruff version too old) | `parseAgentJson` returns fallback `[]`; treat as zero violations and proceed. |
| mypy output has no parseable error count | Treat as zero errors; proceed to pytest. |
| GREEN retry also fails the ruff/mypy pre-check | Return `LaneOutcome` with `status: 'failed'`, `stage: 'GREEN'`, and `error: 'ruff_lint_error: ...'` or `'mypy_type_error: ...'` encoding the last failure. |
| `implFiles` is empty (e.g. structural lane) | Skip both checks; proceed directly to the existing pytest gate. Structural lanes already take the `runRefactor` path before reaching GREEN. |
| ruff/mypy output exceeds token budget of `agent()` | Truncate to first N errors (e.g. top 10 by line number) before passing back to GREEN retry. Prevents prompt overflow. |
| ruff exits non-zero but reports only warnings (W-codes) | If the violations array contains only warning-level codes with no E-codes, treat as pass (warnings do not block). |

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Wall-clock overhead per lane (ruff + mypy, passing) | < 5 seconds total (both tools on typical impl file set) |
| Token overhead per pre-check `agent()` call | < 500 tokens prompt + response (deterministic shell, no prose) |
| No new npm/pip dependencies | ruff and mypy must already be resolvable in the dev environment |
| Observability: which check failed is always logged | `log()` call before every pre-check `agent()` call and after result parsed |
| Backward compatibility: lanes with empty implFiles | Zero behavior change — both checks are no-ops when `implFiles.length === 0` |
| Build: generated JS always in sync | `scripts/build-workflows.sh` must be run and its output committed alongside the TS edit |

## Out of Scope

- Adding ruff or mypy to the RED phase (RED tests intentionally import symbols that do not exist yet).
- Running ruff/mypy on test files (`testFiles`) — only `implFiles` are checked.
- Blocking on ruff warnings (W-codes) — only errors (E-codes) block.
- Adding new pip/npm dependencies — ruff and mypy are already in the dev environment.
- Changing the existing pytest verification flow — this is a pre-filter, not a replacement.
- Adding ruff/mypy to the REFACTOR phase (`runRefactor`, lines 367–426).
- Adding a new `FailureStage` enum value — the `error` string prefix encodes the tool name, and `stage` stays `'GREEN'`.
- Persisting pre-check results outside the lane outcome (no new DB/file artifacts).
- Running the pre-checks in parallel — sequential (ruff before mypy) enforces fail-fast ordering.

## Open Questions

### Q1: Retry exhaustion behavior

Does the GREEN phase have a max retry count, or does it fail after the first retry? Currently, line 299 runs one retry (escalating to `deep`). Does the ruff/mypy pre-check re-run after the retry (loop), or does a second pre-check failure produce an immediate lane failure?

**Decision needed**: Should the pre-check+retry cycle loop up to N times, or is one retry (matching the existing pytest-failure retry behavior) the ceiling?

### Q2: Error truncation threshold

What is the maximum number of ruff or mypy errors to pass back to the GREEN retry agent? Passing 200 lint errors bloats the prompt. A truncation limit (e.g. top 10 by line number) is assumed — confirm the limit or specify one.

### Q3: File discovery scope

`implFiles` comes from `classifyFiles(lane.files)` and contains only the files listed in the lane plan for this lane. Should ruff/mypy check ONLY those files, or all `.py` files written/modified since the last commit (i.e. `git diff --name-only HEAD`)?

**Default assumption**: check `implFiles` from the lane plan only.

### Q4: Mypy configuration flags

Should mypy use the repo's existing `pyproject.toml` / `mypy.ini` configuration, or a specific flag set (e.g. `--ignore-missing-imports`)? If the repo has no mypy config, a permissive default (`--ignore-missing-imports`) avoids false positives on stubs/vendored code.

### Q5: Observability field name

The ticket says "track which check caught the error in the lane outcome." The minimal-diff approach encodes it in `LaneOutcome.error` as a string prefix (`ruff_lint_error:`, `mypy_type_error:`). If downstream consumers (triage agent, dashboard) need to filter by pre-check type programmatically, a structured field (e.g. `pre_check_failure?: 'ruff' | 'mypy' | null`) on `LaneOutcome` would be cleaner — but requires touching `types.ts` and all consumers. Confirm: string prefix or structured field?

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| A1 | `ruff` and `mypy` are in PATH inside the agent sandbox | Ticket states "already in the dev environment"; existing CI/CD uses both | guess | Q0 (verify in env) |
| A2 | GREEN agent retries on ruff/mypy failure using the existing `greenRetryPrompt` + structured error context | Ticket says "pass structured error output back to a GREEN retry"; the only retry path in the code is `greenRetryPrompt` at line 301 | confirmed | n/a |
| A3 | `LaneOutcome.error` string prefix is sufficient for observability without a schema change | The `error` field is already a free-form string; all existing error encodings use a `prefix:` pattern; downstream triage is text-based | guess | Q5 |
| A4 | Pre-checks use `agent()` with `"Run: ..."` prompt, not a native subprocess | The sandbox exposes no `exec`/`spawn` global; all existing deterministic checks (lines 59–63, 173–177, 186–208) use `agent()` | confirmed | n/a |
| A5 | Both checks run on `implFiles` from `classifyFiles()`, not on all modified files | `implFiles` is already derived at line 97 and is the correct scope; checking unrelated files would produce false positives | confirmed | Q3 |
| A6 | Retry ceiling stays at 1 (matching existing behavior) | Current code has exactly one retry per stage; adding a loop would be a larger behavior change | guess | Q1 |
| A7 | ruff `--output-format=json` is available (ruff >= 0.1.0) | ruff has supported JSON output format since its initial releases | guess | A1 |
| A8 | mypy `--no-error-summary` is the correct flag to use | Reduces noise in mypy output for machine parsing; confirmed in mypy docs | confirmed | Q4 |
| A9 | Structural lanes never reach the GREEN ruff/mypy gate | `isStructural` check at line 106 routes structural lanes to `runRefactor` before GREEN | confirmed | n/a |

## Classification Metadata

```yaml
estimated_files: 2
estimated_loc: 60
clusters_touched:
  - datum-tdd-act-lane (GREEN phase, lines 268-325)
  - shared/types (LaneOutcome — string field only, no new type variants unless Q5 resolves to structured field)
new_public_api: false
dependency_additions: []
```
