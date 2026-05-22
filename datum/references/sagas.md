# Playbook: Saga Compensations (State Machine Rollbacks)

**Goal:** Treat the DATUM pipeline as a distributed transaction. Every phase that mutates state must have a registered "compensation" (rollback action) in case a downstream phase fails terminally.

## The Rule of 2 Retries
If any phase hits a terminal failure (e.g., an agent enters a reasoning loop or `VALIDATE` fails 3 times), the Orchestrator MUST:
1. Execute the compensation for the failing phase (wipe the slate clean).
2. Increment the global `epic_retry_count`.
3. Restart the epic from the beginning of the `ACT` phase.
4. **Halt and escalate to human** if `epic_retry_count == 2`.

## Compensating Actions

| Phase | Action | Compensation (If downstream fails) |
|---|---|---|
| **01-Refine** | Writes `SPEC.md`, `PROPERTIES.md` | Delete files. |
| **04-Act** | Creates `git worktree` at `.datum/worktrees/<RUN_ID>`, writes code | `git worktree remove --force .datum/worktrees/<RUN_ID> && git worktree prune` |
| **05-Validate** | Runs tests | No state mutation; no compensation needed. |
| **06-Review** | Writes `REVIEW-REPORT.md` | Delete `review-packets/` and report. |
| **08-Closeout**| Merges PR, writes `MEMORY.md` | See `datum/references/rollback.md` (Post-merge revert commit). |

## Execution Protocol (Orchestrator)
When a sub-agent hits a terminal failure:
1. **Log the failure:** Write the error to `.datum/runs/<RUN_ID>/terminal_failure.log`.
2. **Rollback:** Execute the compensations in reverse order (LIFO) until the repository is back to a clean state (`main` branch, no uncommitted changes).
3. **Retry:** If `retries < 2`, initialize a new `git worktree` at `.datum/worktrees/<RUN_ID>` and dispatch the TDD loop again.
4. **Escalate:** If `retries == 2`, halt the pipeline entirely. Do not attempt a 3rd try. Surface the `terminal_failure.log` to the user.
