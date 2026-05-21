# Recovery Modes

## Diagnosis First

Before any retry, run `python3 scripts/diagnose_failure.py <log_path>`.
The classifier returns one of: `ENVIRONMENTAL`, `REASONING`, `UNKNOWN`.

This distinction matters because escalating the model tier for an environmental failure wastes tokens and doesn't fix the root cause.

## Environmental Failures → Fix in Place

Retry counter NOT incremented. Same model tier. Fix the environment, then re-dispatch.

| Symptom | Fix |
|---|---|
| Stale file path in brief | Re-resolve via `gitnexus context`, rewrite brief |
| Stub not yet committed for upstream signature dependency | Wait for stub commit, re-dispatch |
| Lint auto-fixable violation | Run linter `--fix`, re-verify |
| Format mismatch | Run formatter, re-verify |
| Stale GitNexus index | `gitnexus analyze`, retry |
| Subagent timeout | Re-dispatch single agent |
| Dirty working tree from crashed agent | `git stash` or `git restore`, retry |
| Test ratchet violation on accidental edit | Revert non-test changes, retry |
| Patch failed to apply (overlapping commit) | Fetch HEAD, rebase agent context, retry |

## Reasoning Failures → Retry Ladder

Retry counter incremented. Two orthogonal escalations happen in parallel: model tier escalation
(smarter model) and backoff delay (wait before retrying). These are independent — backoff
prevents burning a Reasoning-tier budget on transient issues like rate limits or flaky CI.

**Backoff formula (from Symphony):**
```
delay_ms = min(10_000 × 2^(attempt − 1), max_retry_backoff_ms)
```
Default `max_retry_backoff_ms` = 300,000 (5 minutes). This gives:
- Attempt 1 → wait 10s before dispatching
- Attempt 2 → wait 20s
- Attempt 3 → wait 40s (capped at 5min for large attempt counts)

The backoff is separate from ENVIRONMENTAL fix time (which is unbounded — wait for stub,
wait for linter, etc.). Backoff applies only to REASONING retries.

| Attempt | Backoff | Model tier | Action |
|---|---|---|---|
| 1 | 10s | Standard | Retry with same brief, NEW agent |
| 2 | 20s | **Reasoning** | Rewrite brief with diagnostics from attempt 1 |
| 3 | 40s | Reasoning | Verbose mode + full failure context from attempts 1-2 |
| Post-3x | — | — | Halt lane; surface diagnostic packet to user |

**Known reasoning causes:**
- Syntactically valid but semantically wrong code
- Agent missed an AC explicitly listed in the brief
- Agent failed to use an available lane-tool that the brief named
- Test passes but logic is aimed at a different interpretation of the spec

## Hard Stops → No Retry

Surface immediately. No retry, no escalation.

| Cause | Why |
|---|---|
| Hook blocked write (layer boundary, banned pattern) | Deterministic enforcement; retry won't help |
| Test ratchet violation (intentional, not a stray edit) | Agent must not weaken tests |
| Lane-tool sandbox violation | Security boundary; investigate before re-enabling |
| External dependency install attempted | Must surface to user for approval |

## Unknown → Conservative Retry

Enter the retry ladder (same as reasoning), but log the new pattern for future classification.
After the epic, review unknowns to improve the pattern library.

## No-Diff Guard

After each stage commit, run `scripts/no_diff_guard.py` with the before/after SHAs:

- **First no-diff:** allow, mark `consecutive_no_diff: 1`, log a warning
- **Second consecutive no-diff (same lane + stage):** halt lane early

Two consecutive no-diffs means the agent is stuck. Stall classified as REASONING;
model escalates on next dispatch. Written to `.datum/runs/<RUN_ID>/no-diff-stalls.json`.
Investigation tasks (no code expected) should pass `--expected-no-diff` to skip this guard.

## Flaky Test Protocol

When a test passes on re-run but failed initially:
1. Re-run 3 times total
2. If 2+ of 3 pass: classify as flaky
3. If fewer than 2 pass: treat as legitimate failure (reasoning cause)

For flakies:
- Add flaky annotation with `// FLAKY: epic-N <RUN_ID>` comment
- Exclude from green-gate for this epic
- Log to `follow-ups.json` as high-severity `flaky_test`
- Lane proceeds

At the start of a new epic: if pending flakies > configured threshold (default 3), refuse to start. User must triage.

## diagnose_failure.py Pattern Library

The classifier checks against a library of known patterns. Patterns ship in v1:

**Environmental patterns:**
- `error: no such file or directory` → stale path
- `error: type '...' has no member` when member is a stub not yet committed → stub dependency
- `warning: ... auto-correctable` → lint fixable
- `exit code 124` (timeout) → subagent timeout
- `nothing to commit` after applying patch → duplicate commit

**Reasoning patterns:**
- `assertion failed: expected X but got Y` (after GREEN stage) → wrong implementation
- `test passes but AC N not satisfied` → AC gap
- `lane-tool available but not used` → tool discovery failure

Unknown patterns are logged to `.datum/runs/<RUN_ID>/unknown-failures.json` for post-epic review.
