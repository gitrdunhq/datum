# Rollback Protocol

`datum rollback <run_id>` reverts a merged epic cleanly. It does not undo git history destructively —
it creates a new revert commit and opens it as a new epic, entering at the PR Comments phase.

**Design principle (from Symphony):** rolling back is filing a new task, not reversing time.
The revert commit is the "implementation." The pipeline's job is to verify the revert is safe
and get it merged.

---

## When to use

- Merged code caused a production regression
- A gate that should have caught the issue was misconfigured or bypassed
- A property violation was discovered post-merge

Do NOT use rollback for partial reverts (revert one task from a multi-task epic). File a new
ticket instead and run the normal cycle.

---

## The 9-step protocol

Run: `python3 scripts/rollback.py --run-id <run_id>`

```
1. Load closeout-data.json for the run_id → get merge_sha, work_branch, PR URL
2. Verify current HEAD is reachable from merge_sha (guard: don't rollback a rollback)
3. Create revert commit:
   git revert <merge_sha> --no-edit
4. Create rollback branch:
   datum/epic-N-rollback-<original_run_id_short>
5. Open revert PR via gh CLI with generated description linking to original
6. Generate new RUN_ID: epic-N-rollback-<YYYYMMDD>-<hhmmss>
7. Write state.json for the rollback run:
   - current_phase: pr_comments
   - rollback_of: <original_run_id>
   - git.work_branch: <rollback branch>
   - git.pr_url: <new revert PR URL>
8. Verify tests pass on the reverted branch (run full suite; if RED → surface immediately)
9. Transition to PR Comments phase with the revert PR as the open PR
```

---

## What rollback does NOT do

- Does NOT re-run ACT. The revert commit is the implementation — no RED/GREEN/REFACTOR needed.
- Does NOT re-run Plan or Properties. Scope is fixed: revert the merge commit.
- Does NOT close the original epic's issues. Those remain for the team to triage.

---

## State schema for rollback runs

```json
{
  "run_id": "epic-5-rollback-20260101-140000",
  "rollback_of": "epic-4-20260101-120000",
  "current_phase": "pr_comments",
  "git": {
    "base_branch": "main",
    "work_branch": "datum/epic-5-rollback-epic4",
    "revert_sha": "abc123",
    "original_merge_sha": "def456",
    "pr_url": "https://github.com/..."
  }
}
```

---

## If tests fail after the revert

This means the original epic fixed a bug that now resurfaces when reverted. The pipeline
surfaces this as a hard decision:

```
Option 1: Proceed anyway — revert and accept the re-surfaced failure as a known issue
Option 2: Halt — investigate the interaction before reverting
Option 3: Partial rollback — file a new ticket for the regression instead of a full revert
```

This is a required human decision. Rollback never auto-merges a red test suite.

---

## Closeout after rollback merge

Rollback runs go through normal Closeout. The RETRO notes it as a rollback with the original
run_id linked. `follow-ups.json` will contain a high-priority entry: "investigate root cause
that required rollback of epic N."
