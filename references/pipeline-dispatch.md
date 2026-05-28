# Pipeline Dispatch

## Lane Model

Each task is one lane. Lanes flow independently: Lane A's GREEN can run while Lane B is still in RED. There is no wave synchronization.

```
Time →
Lane A:  [stub]──[RED]──verify──[GREEN]──verify──[REFACTOR]──done
Lane B:        [RED]──────────verify──[GREEN]──────────verify──[REFACTOR]──done
Lane C:               [RED]──verify──[GREEN]──verify──[REFACTOR]──done
Lane D:                     queued (blocked: Lane A behavior-dependency)
Lane E:                              queued (blocked: file-conflict with Lane C)
```

## Scheduler Constraints

The scheduler (`scripts/pipeline_scheduler.py`) enforces five rules simultaneously:

1. **Within-lane sequencing**:
   - For `behavioral` tasks: RED → GREEN → REFACTOR is strict per lane.
     - GREEN does not start until RED's test commit is landed.
     - GREEN (behavior) dependency: if this task depends on an upstream task for behavior (not just signatures), GREEN waits for the upstream lane's GREEN commit.
     - REFACTOR does not start until GREEN is committed and test runner is green.
   - For `structural` tasks: RED and GREEN are bypassed. The lane proceeds immediately to REFACTOR to implement the structural change in a single pass.

2. **Dependency DAG**: Built from `lane-plan.json`.
   - Signature dependency (satisfied by stub commit) → unblocks downstream RED
   - Behavior dependency (satisfied by GREEN commit) → unblocks downstream GREEN

3. **File-ownership conflict gating**: Two lanes writing to the same file cannot be in their write stages simultaneously.
   - Reads do not conflict.
   - Scheduler holds a lane at stage boundary if its next stage would conflict with an in-flight write.

4. **Concurrency cap**: At most `in_flight_cap` (default: 7) agents running across all lanes and stages.

5. **Commit serialization**: All commits go through the commit queue. No concurrent branch writes.

## Commit Queue

The commit queue (`datum commit-queue`) is a single Python process:
- Spawned at pipeline start, shut down at pipeline end
- Listens on a Unix socket: `.datum/runs/<RUN_ID>/commit-queue.sock`
- Maintains a FIFO queue ordered by stage completion time
- Holds an advisory lock on `.datum/locks/branch.lock`

Protocol for each commit:
```
Lane signals: { lane_id, stage, patch (unified diff), commit_message, file_set }
Queue:
  1. Acquire advisory lock
  2. Require a clean worktree except queue-owned `.datum/` runtime files
  3. Apply patch: git apply --3way --whitespace=fix
  4. Verify changed files are a subset of declared `file_set`
  5. Stage only changed files from `file_set`
  6. On success: run pre-commit hooks (ratchet, layer boundary, etc.)
  7. On hook pass: create commit, update HEAD
  8. Release lock
  9. Signal lane: { success: true, sha: "..." }
```

On patch failure (overlapping lines — should be prevented by conflict gating, but can happen if gating has a bug):
- Classify as ENVIRONMENTAL failure (not agent reasoning failure)
- Send back to agent with conflict diagnostic + current HEAD context
- Retry counter NOT incremented

If the worktree is dirty before patch application, the queue refuses the commit. It never stages
unrelated user changes and never restores a tree it did not start from clean.

## Diff Application Protocol

All lane outputs reach the commit queue as unified diffs regardless of source tool.

Tool adapters translate to unified diff before the patch reaches the queue:
- **Claude Code, Codex**: agents produce str_replace or native diffs; adapter wraps to unified diff
- **opencode, Kiro, Gemini CLI**: adapter captures write operations against a scratch directory, then `diff -u scratch original`

The commit queue always applies via `git apply --3way`. This is the single audit point.
Every diff is archived in `.datum/runs/<RUN_ID>/patches/` for replay.

## Lane Failure

A lane that exhausts its 3x retry budget halts only itself. Other lanes continue.
The orchestrator collects the diagnostic packet and surfaces it at the next sync point (or immediately if it blocks dependent lanes).

## Sync Point

```
All lanes done (completed or failed_terminal)
        ↓
Sync barrier
        ↓
Validate → Review → PR Comments → Closeout
```

Surface failed lanes' diagnostics before transitioning to Validate. Let the user decide:
- Proceed without failed lanes' changes
- Retry specific failed lanes
- Halt the pipeline
