# Act phase: epic-scoped content-addressed lane completion, wave-aware batching, failed-dep blocking, GREEN merge gate (#281)

## What
Umbrella fix for the epic-287 act-phase failure cluster (#274-#280). Evidence run `wf_429284b8-c91` on `the-record-suite`, branch `datum/epic-287`, 2026-07-06 — a 22-lane plan finished 1/22 succeeded, 7 failed, 14 skipped, ~167 live agents / ~2.35M tokens / 45+ min, with a RED-only commit (`red(task-002): RED complete`) landed on the epic branch. Fix the five root causes below in `skills/src/datum-go.ts`, `skills/src/datum-tdd-act.ts`, `skills/src/datum-tdd-act-lane.ts`, `skills/src/datum-tdd-act-merge.ts`, and the `datum` CLI.

## Requirements

### A. Epic-scoped, content-addressed lane state
Move completion markers from `.datum/runs/<runId>/lane-state/<taskId>.json` (invisible across sessions/batches — every invocation mints a fresh runId, and the batch loop further suffixes `-b0`/`-b1`, so a lane completed in one batch/session is invisible to the next) to `.datum/epics/<epic-branch-slug>/lane-state/<taskId>.json` with schema:
```json
{ "schema_version": "1.0", "task_id": "task-002", "status": "completed", "epic_branch": "datum/epic-287", "merge_commit": "<sha>", "spec_hash": "<sha256 of canonical {files, acceptance_criteria, depends_on}>", "run_id": "20260706-121711-b0", "completed_at": "2026-07-06T12:59:00Z" }
```
Skip a lane iff **all three** hold: marker exists with `status: completed`; `spec_hash` matches the current lane-plan entry's hash (plan edited → lane re-runs); `merge_commit` is an ancestor of the current epic branch head (`git merge-base --is-ancestor`) — self-healing against reverts/rebases. Keep writing the legacy per-run marker for backward compat during transition; read epic-scoped first.

### B. Wave-aware batch partitioning
`skills/src/datum-go.ts:190-197` and `skills/src/datum-tdd-act.ts:81-96` compute `buildWaves(lanePlan)` (logged as e.g. "22 lanes in 8 waves") then discard it, instead slicing `topological_order` into naive chunks of `MAX_BATCH` (5). This puts a lane and its dependents in the same concurrent batch. Replace with: pack whole waves into batches greedily up to `MAX_BATCH` lanes; a wave larger than `MAX_BATCH` may split freely (intra-wave lanes are independent by construction). Guarantee: a lane's deps are always in a strictly earlier, already-completed batch.

### C. Failed/skipped deps must block dependents
The cross-batch dependency check in both files (`const missing = deps.filter((d) => !batchLaneIds.includes(d) && !completedLanes.includes(d) && !failures.includes(d))`) treats a dep in `failures` as "not missing", so dependents dispatch anyway against a codebase where the dep's contract doesn't exist (caused #276, #279 on epic-287). Drop the `!failures.includes(d)` exemption. A dependent of a failed/skipped dep must get a new status `"blocked"` (distinct from `"skipped"`) with `error: "dep <id> failed at <stage>"`. Triage should group blocked-chains under the root failure instead of reporting N independent failures.

### D. Merge gate: GREEN or it doesn't merge
`datum/epic-287`'s epic branch now carries `red(task-002): RED complete` — failing tests, no implementation — merged onto the epic branch, because the merge stage doesn't check the lane's final stage. `datum-tdd-act-merge` must check the candidate lane branch's completion marker says GREEN/REFACTOR-complete before including it in the squash-merge. RED-only branches are left in place and reported, never merged.

### E. Deterministic ops via `datum` CLI, not agents
Trivial 1-line ops (`completion-check:${taskId}` cat, `completion-write:${taskId}` mkdir+write, runId generation via `date`) each spin up a full fast-model agent (~20-60s, serialized under the 2-concurrent cap) and dominate wall-clock on large runs (~167 of the evidence run's agent executions). Add `datum lane-state read|write --epic <branch> --task <id> [--merge-commit <sha>]` (or similar) as a deterministic CLI call, and reference files in downstream agent prompts instead of embedding volatile bytes (which breaks the workflow's resume-prefix replay cache).

## Acceptance Criteria
- [ ] Re-invoking act on an epic whose lanes are already merged dispatches **zero** agents for those lanes beyond one state read per batch (epic-287 batch 1 replays in seconds, not ~30 min).
- [ ] Editing a completed lane's `files[]`/acceptance criteria in the lane plan invalidates only that lane's marker (spec_hash mismatch) — it re-runs; untouched lanes still skip.
- [ ] Reverting a merged lane's commit on the epic branch invalidates its marker (ancestor check fails) — it re-runs.
- [ ] A lane whose dep failed is reported `blocked` with the root-cause lane id + stage; it never dispatches RED/GREEN agents.
- [ ] No batch contains a lane concurrent with its own dependency (property test over random DAGs: wave-packed partition never violates dep ordering).
- [ ] A lane branch whose pipeline ended RED is never merged; the epic branch after act contains no `red(...)`-only tip commits.
- [ ] Per-lane state bookkeeping adds no fast-model agent calls (CLI direct).

## Not This
- Don't redesign the lane-plan schema or dependency model beyond adding `spec_hash`/`blocked` status.
- Don't touch RED-phase prompt hygiene beyond what's needed to support D (already partially addressed in 4b15f7f).
- Don't change concurrency caps or model tiers — this is about correctness of state/ordering, not throughput tuning.

## Evidence
- Run: `wf_429284b8-c91`, journal at `the-record-suite` session `34049556-…/subagents/workflows/wf_429284b8-c91/journal.jsonl` (167 started / 164 results, zero duplicate keys).
- Act log: `Topology: 22 lanes in 8 waves` → `Auto-partitioned 22 tasks into 5 batches` → `Act complete — 1/22 succeeded, 7 failed, 14 skipped`.
- RED-only commit on epic branch: `the-record-suite` `d367e9ee red(task-002): RED complete`.
- Symptom issues from this run's triage: #274 #275 #276 #277 #278 #279 #280.
