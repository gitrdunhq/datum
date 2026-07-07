# SPEC: Act-phase epic-scoped lane completion, wave-aware batching, failed-dep blocking, GREEN merge gate (#281)

## 1. Summary

The 22-lane act run on `datum/epic-287` (`wf_429284b8-c91`) scored 1/22 succeeded, 7 failed, 14 skipped, burned ~2.35M tokens across ~167 agent dispatches, and left a RED-only commit merged onto the epic branch. This umbrella fix closes the five root causes: batch loops that discard the already-computed wave partition and re-slice naively (violating dependency ordering), a dependency-block check that treats `failures` as satisfied instead of blocking, a merge stage with no GREEN/REFACTOR-complete gate, and deterministic 1-line state ops (`cat`, `mkdir+write`, `date`) still routed through full fast-model agents. Fixing these turns a re-run of an already-merged epic into a near-instant no-op and prevents dependency-violating dispatch and RED-only merges going forward.

## 2. Context

Two of the five root causes are **already implemented** per the codebase scan and require no further work in this ticket beyond verification:

- **Epic-scoped, content-addressed lane state (Req A)**: `laneSpecHash` and `epicSlug` (`skills/src/shared/utils.ts`) plus `laneStateReadPrompt`/`laneStateWritePrompt` (`skills/src/shared/prompts.ts`, templates `skills/src/prompts/lane-state-read.md` / `lane-state-write.md`) are wired into both `skills/src/datum-go.ts` and `skills/src/datum-tdd-act.ts`. The marker schema, precedence (epic-scoped first, legacy run-scoped fallback), and the `git merge-base --is-ancestor` check match the ticket exactly.
- **`blocked` status plumbing (Req C, partial)**: `LaneStatus` in `skills/src/shared/models.ts:42` already includes `'blocked'`. The outer batch loops in `datum-go.ts` (~235-250) and `datum-tdd-act.ts` (~134-149) already compute `failedDeps` (deps in `failures` OR with `status === 'blocked'`) separately from `neverRan` and mark dependents `status: 'blocked'` with an error message. What remains is wiring `blocked` lanes into triage.

Three gaps remain and are the actual scope of this SPEC:

- **Requirement B (wave-aware batching) is NOT implemented.** `buildWaves(lanePlan)` (`skills/src/shared/utils.ts:29`, Kahn's-algorithm BFS) is called and logged in both `datum-go.ts:190-197` and `datum-tdd-act.ts:81-96`, then its return value is discarded — both files re-derive `allLaneIds` from `lanePlan.topological_order` and slice into naive `MAX_BATCH`-sized (5) chunks (`datum-go.ts:217-222`, `datum-tdd-act.ts:111-116`). This is the direct cause of the evidence run's dependency-violating batches.
- **Requirement D (GREEN merge gate) is NOT implemented.** `datum-tdd-act-merge.ts` (37 lines) — `MergeArgs` carries only `completedIds`/`epicBranch`/`batchRunId`/`topoOrder`/`batchTag`, no per-lane stage/marker info — squash-merges `completedIds` via `datum worktrees merge` with no independent check of each candidate's final TDD stage. This is a defense-in-depth gap: upstream `status === 'completed'` should already imply GREEN, but the evidence bug (`red(task-002): RED complete` merged) shows that invariant was violated once (partially addressed upstream in 147e800) and merge has no second check.
- **Requirement E (deterministic CLI) is NOT implemented.** No `lane-state` subcommand exists in `datum/cli.py` — only the `worktrees setup/merge/cleanup` sub-app pattern (`datum/cli.py:1468-1512`) and the simpler `lane-cleanup` single command (`datum/cli.py:504`) exist as precedent. `skills/src/datum-tdd-act-lane.ts:150-184` still performs `completion-check:${taskId}` / `completion-write:${taskId}` (legacy run-scoped path) via full agent-dispatched `cat` / `mkdir+write`, and both `laneStateReadPrompt`/`laneStateWritePrompt` in `datum-go.ts`/`datum-tdd-act.ts` do the same for the epic-scoped path via an inline python heredoc under `model('fast')`.

Also in scope: `TriageArgs` (`skills/src/shared/types.ts:47-56`) and `skills/src/datum-tdd-act-triage.ts` have no `blocked` field — blocked lanes are logged in the local ACT COMPLETE summary but never reach triage, so grouping blocked-chains under their root failure has no code path today.

## 3. Requirements

### R1 — Wave-aware batch partitioning replaces naive chunking

Replace the "compute `buildWaves`, log it, then discard it" pattern in `skills/src/datum-go.ts` (~190-222) and `skills/src/datum-tdd-act.ts` (~81-116) with a greedy wave-packing partitioner: iterate waves in order, accumulate lanes into the current batch up to `MAX_BATCH`; when adding a whole wave would exceed `MAX_BATCH`, split that wave freely across batch boundaries (intra-wave lanes are mutually independent, so splitting is always safe); never start a batch that contains a lane from a wave whose predecessor wave is not fully assigned to a strictly earlier batch.

**Acceptance criteria:**
- [ ] For a lane plan with 22 lanes in 8 waves (mirroring the evidence run's topology) and `MAX_BATCH = 5`, no lane ID in batch *N* has a `depends_on` entry present in batch *N* or any batch ≥ *N*.
- [ ] A property test generates random DAGs (10-50 nodes, random edges respecting acyclicity) via `buildWaves`, runs the new partitioner, and asserts for every lane: all of its `depends_on` IDs are in a strictly earlier batch index.
- [ ] A wave larger than `MAX_BATCH` is split across ≥2 consecutive batches with no functional-completeness violation (every lane in the oversized wave is scheduled).
- [ ] Existing "N lanes in M waves" log line is preserved; a new log line reports the resulting batch count and confirms it is wave-derived (e.g., "Wave-packed 22 tasks into 6 batches").

### R2 — Failed/blocked deps unconditionally block dependents

Remove the `!failures.includes(d)` exemption from the cross-batch dependency check in both `skills/src/datum-go.ts` and `skills/src/datum-tdd-act.ts` (the `missing` computation). A dependent of any dep with `status` in `{'failed', 'blocked'}` (whether from `failures`, `completedLanes` exclusion, or a same-batch `depResults` failure) must never dispatch RED/GREEN agents and must be recorded with `status: 'blocked'`, `stage: 'SKIPPED'`, and `error: "dep <id> failed at <stage>"` (or the equivalent multi-dep message already emitted).

**Acceptance criteria:**
- [ ] A lane whose single dependency is in `failures` is marked `blocked` (not dispatched) and its `error` field names the failed dep ID and the stage at which it failed.
- [ ] A transitive chain (A fails → B depends on A → C depends on B) results in both B and C marked `blocked`, each carrying the correct upstream dep reference — no lane in the chain beyond the root dispatches an agent.
- [ ] `skills/src/datum-tdd-act-lane.ts`'s in-file DAG gating (~673-734), which independently produces `status: 'skipped'` for the same condition, is reconciled to also emit `status: 'blocked'` so the two code paths report a consistent status for a dependency-failure condition (no lane-plan run should show `skipped` for what is actually a blocked dependency).

### R3 — Triage groups blocked-chains under their root failure

Extend `TriageArgs` (`skills/src/shared/types.ts:47-56`) with a `blocked: LaneOutcome[]` field (or equivalent), pass it from both `datum-go.ts` and `datum-tdd-act.ts` callers alongside the existing `failures`, and update `skills/src/datum-tdd-act-triage.ts`'s prompt/logic so that every blocked lane is nested under the failure entry for the dep it (transitively) blocked on, rather than being omitted or reported as an independent failure.

**Acceptance criteria:**
- [ ] Triage output for a run with 1 root failure and 3 transitively blocked dependents shows 1 top-level failure group containing 4 lane entries (root + 3 blocked), not 4 independent failure entries.
- [ ] Two independent failure chains (unrelated root causes) produce 2 separate groups, each containing only its own root and its own blocked descendants.
- [ ] A lane plan with zero blocked lanes produces identical triage output to the current behavior (no regression for the common case).

### R4 — Merge gate requires GREEN/REFACTOR-complete before squash-merge

`skills/src/datum-tdd-act-merge.ts`'s `MergeArgs` gains per-candidate stage information (read via the epic-scoped lane-state marker, or passed through from the caller's already-known `LaneOutcome.stage`). Before including a lane ID in the `datum worktrees merge` call, the merge stage must verify the candidate's final stage is GREEN or REFACTOR-complete (never RED-only). Lanes failing this check are excluded from the merge set and reported separately (not silently dropped).

**Acceptance criteria:**
- [ ] A `completedIds` list containing a lane whose lane-state marker (or `LaneOutcome.stage`) shows `RED` is excluded from the `datum worktrees merge` invocation; the merge proceeds with the remaining GREEN/REFACTOR-complete lanes.
- [ ] The excluded RED-only lane is surfaced in the merge stage's output/log as "left in place, not merged" with its lane ID and branch name, not silently swallowed.
- [ ] After a merge run, `git log` on the epic branch tip contains no commit matching `^red\(.*\): RED complete` (or equivalent RED-only commit-message pattern) introduced by this merge invocation.
- [ ] A lane plan where all candidates are GREEN/REFACTOR-complete merges identically to current behavior (no regression).

### R5 — Deterministic `datum lane-state` CLI replaces agent-dispatched state ops

Add a `lane_state` Typer sub-app to `datum/cli.py` (following the `worktrees_app` pattern at `datum/cli.py:1468-1512`) exposing:
- `datum lane-state read --epic <branch> --task <id>` → reads `.datum/epics/<epicSlug>/lane-state/<task>.json` (falling back to legacy `.datum/runs/<runId>/lane-state/<task>.json` when epic-scoped marker absent), prints the marker JSON (or a "not found" sentinel) to stdout.
- `datum lane-state write --epic <branch> --task <id> --status <status> --merge-commit <sha> --spec-hash <hash> --run-id <runId>` → writes the epic-scoped marker (and, during the transition window, the legacy run-scoped marker) atomically.

Replace the inline agent-dispatched `completion-check:${taskId}` / `completion-write:${taskId}` calls in `skills/src/datum-tdd-act-lane.ts:150-184`, and the `laneStateReadPrompt`/`laneStateWritePrompt` agent-dispatched python-heredoc flow in `datum-go.ts`/`datum-tdd-act.ts`, with direct `datum lane-state read|write` subprocess calls from the TS workflow scripts. Downstream agent prompts reference the marker file path rather than embedding its contents inline (preserving the resume-prefix replay cache).

**Follow-on scope (tracked, not required for this ticket's acceptance criteria):** the same centralize-into-CLI rationale applies beyond lane-state. `datum-tdd-act-lane.ts` currently has agents compose raw shell (`bash scripts/test-count-gate ...`, `grep -c -E ...`, `git diff --name-only ...`) for test-count gating, placeholder-assertion scanning, and file-ownership checks — each a distinct Bash permission-classifier surface, and each fragile to LLM shell-transcription errors (root cause of the #288/#289 test-count-gate false negatives, worked around in commits `507e956`/`8dddb3f`/`d5aad90` via bare-regex + base64 encoding + per-lane language inference). A future ticket should fold `test-count-gate`, the placeholder-assertion `sgPatterns` scan, and the file-ownership diff into `datum` subcommands (e.g. `datum test-count-gate --repo --files --language --required`, `datum lane assert-check`) so agents invoke one deterministic, already-permissioned CLI instead of composing raw grep/git/base64 pipelines per call. Out of scope here to avoid re-touching lanes already mid-flight in this epic's own run.

**Acceptance criteria:**
- [ ] `datum lane-state read --epic datum/epic-287 --task task-002` exits 0 and prints valid JSON matching the schema in Requirement A when a marker exists; exits with a distinct non-zero code (or documented "not found" JSON) when absent.
- [ ] `datum lane-state write ...` is idempotent: writing the same marker twice produces byte-identical file contents (excluding `completed_at` unless explicitly re-supplied).
- [ ] Re-invoking act on an epic whose lanes are already merged results in zero fast-model agent dispatches for lane-state read/write — only direct `datum lane-state` subprocess calls (verified by counting agent-dispatch log lines for `completion-check:`/`completion-write:`/`lane-state-read`/`lane-state-write` labels: expect 0).
- [ ] The resume-prefix replay cache is unaffected: two runs against an identical epic state produce identical prompt hashes up to the point a marker file's mtime/path (not its embedded content) is referenced.

## 4. Failure Modes

| Failure Mode | Handling |
|---|---|
| Lane plan is edited (files/acceptance_criteria/depends_on changed) after a lane already completed | `spec_hash` mismatch invalidates the marker; lane re-runs. Untouched lanes' markers still match and skip (R-A, already implemented). |
| Merged lane's commit is reverted/rebased off the epic branch | `git merge-base --is-ancestor` check fails; marker treated as invalid; lane re-runs (R-A, already implemented). |
| A wave is larger than `MAX_BATCH` | Wave splits freely across ≥2 consecutive batches (R1); never merged into an adjacent wave's batch to avoid violating dependency ordering. |
| Dependency fails mid-batch (same-batch dep failure, not cross-batch) | In-file DAG gating in `datum-tdd-act-lane.ts` (~673-734) already catches this; reconciled under R2 to emit `blocked` consistently with the outer loop. |
| `datum lane-state read` called for a task ID with no marker at all (first run) | Returns a documented "not found" result (non-throwing); caller treats it as "never completed," proceeds to dispatch normally. |
| `datum lane-state write` invoked concurrently for the same task ID from two batches (should not happen given wave ordering, but defensively) | Write is atomic (write-to-temp + rename); last writer wins; no partial/corrupt JSON. |
| Merge gate finds zero GREEN/REFACTOR-complete candidates in a batch (all RED) | Merge step is a no-op for that batch; batch is reported as "0 merged, N left in place" rather than erroring. |
| Legacy per-run marker and epic-scoped marker disagree (e.g., epic-scoped missing, legacy present) | Epic-scoped marker is authoritative when present; legacy is fallback-only, never overrides an existing epic-scoped marker. |
| `datum lane-state` CLI invoked with a malformed `--epic` branch name (unslugifiable / contains path traversal chars) | CLI rejects with a clear error and non-zero exit before touching the filesystem; no directory created outside `.datum/epics/`. |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Zero-agent replay for fully-merged epic | Re-invoking act on an epic whose lanes are all merged dispatches 0 fast-model agents for lane-state ops per batch; only direct CLI subprocess calls. |
| Batch 1 replay wall-clock (22-lane epic-287-scale plan, fully merged) | Seconds, not ~30 minutes (matches ticket's stated acceptance target). |
| Dependency-ordering correctness | Property test over randomly generated DAGs (≥100 random graphs, up to 50 nodes) must show zero violations of "a lane's deps are always in a strictly earlier, already-completed batch." |
| Merge safety | Zero RED-only commits reachable from epic branch tip after any merge stage run, verified by commit-message pattern scan. |
| CLI determinism | `datum lane-state read|write` must be pure/deterministic given identical filesystem state and inputs — no agent, no LLM call, no network I/O. |
| Backward compatibility window | Legacy per-run marker continues to be written alongside epic-scoped marker for this release cycle; epic-scoped marker is read first, legacy is fallback only. |

## 6. Out of Scope

- Redesigning the lane-plan schema or dependency model beyond adding `spec_hash` (already done) and `blocked` status (already partially done).
- RED-phase prompt hygiene beyond what supports Requirement D (already partially addressed in commit 4b15f7f).
- Changing concurrency caps (`MAX_BATCH` value itself) or model tiers — this ticket is about correctness of state/ordering, not throughput tuning.
- Removing the legacy run-scoped marker entirely (sunset is a future release's work, not this one).
- Redesigning `datum worktrees merge` / `merge_lane_branches` (`datum/worktree_manager.py:163`) internals beyond adding the pre-merge stage-gate filter described in R4 — the underlying git merge mechanics are unchanged.

## 7. Open Questions

None — ambiguity classified as low; all detected gaps were resolved via existing code conventions (see Assumption Audit) rather than requiring a human decision.

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | `epicSlug` already implements a deterministic, filesystem-safe slugification of the epic branch name (e.g. `datum/epic-287` → `datum-epic-287`) and is reused as-is for both R-A (already done) and any new CLI subcommand in R5 | Confirmed present and wired in both `datum-go.ts` and `datum-tdd-act.ts` per codebase scan; no new slug logic needed | confirmed | n/a |
| 2 | `buildWaves(lanePlan)` (`skills/src/shared/utils.ts:29`) correctly computes topological waves via Kahn's algorithm and its output shape (`string[][]`) is sufficient input for the R1 greedy packer with no changes to `buildWaves` itself | Verified via direct code read: function exists, throws on missing deps and cycles, returns waves in dependency order | confirmed | n/a |
| 3 | `git merge-base --is-ancestor` is available in the runtime environment (git binary on PATH wherever epic-scoped marker validation runs) | Standard git subcommand present in any git ≥ 1.8; already invoked by the existing (already-implemented) R-A logic per scan notes | confirmed | n/a |
| 4 | The `datum lane-state` CLI subcommand should follow the exact `worktrees_app` Typer sub-app pattern (`datum/cli.py:1468-1512`) rather than the simpler single-command `lane-cleanup` pattern, since it needs two verbs (`read`/`write`) | `worktrees` sub-app already demonstrates multi-verb sub-app structure in this codebase; reusing an established pattern minimizes review risk and matches "or similar" latitude in the ticket | decided | n/a |
| 5 | Triage groups blocked-chains one-per-dependency-chain-root — i.e., if lane A fails and both B and C independently depend on A, B and C are grouped under A's single failure entry (not duplicated); two unrelated root failures produce two separate groups | Ticket text says "group blocked-chains under the root failure instead of reporting N independent failures" — the natural DAG interpretation is one group per root, consistent with how `failedDeps` is already computed per-lane in the outer batch loop | decided | n/a |
| 6 | Legacy per-run marker write/read continues unchanged this release; full removal is explicitly deferred to a future ticket, not attempted here | Ticket says "keep writing the legacy per-run marker for backward compat during transition" with no removal date specified; treating "this release" as the transition window matches standard backward-compat practice and avoids scope creep into a removal ticket | decided | n/a |
| 7 | The resume-prefix replay cache referenced in Requirement E is the existing workflow-script prompt-hashing/caching mechanism (not a new system to be built) and merely requires that agent prompts reference marker file paths instead of embedding marker JSON bytes inline | Ticket phrasing ("breaks the workflow's resume-prefix replay cache") describes an existing constraint on prompt construction, not a new deliverable; no new caching system is in the requirements list | decided | n/a |
| 8 | CLI exact flag order, output format (plain JSON to stdout), and non-zero exit code convention for `datum lane-state read|write` are implementer's choice within the `worktrees`-pattern precedent, since the ticket explicitly says "or similar" | Ticket text: "(or similar)" — explicit latitude granted; codebase precedent (`worktrees_app`) establishes the surrounding conventions (JSON I/O, Typer flags) to follow | decided | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 8
estimated_loc: 650
clusters_touched:
  - act-phase-orchestration        # skills/src/datum-go.ts, skills/src/datum-tdd-act.ts
  - lane-execution                 # skills/src/datum-tdd-act-lane.ts
  - merge-gate                     # skills/src/datum-tdd-act-merge.ts
  - triage                         # skills/src/datum-tdd-act-triage.ts, skills/src/shared/types.ts
  - cli-datum                      # datum/cli.py, datum/worktree_manager.py
  - shared-utils                   # skills/src/shared/utils.ts (batch partitioner helper), skills/src/shared/models.ts
new_public_api:
  - "datum lane-state read --epic <branch> --task <id>"
  - "datum lane-state write --epic <branch> --task <id> --status <status> [--merge-commit <sha>] [--spec-hash <hash>] [--run-id <runId>]"
  - "packWaves(waves: string[][], maxBatch: number): string[][] (or equivalent name) in skills/src/shared/utils.ts"
dependency_additions: []
```
