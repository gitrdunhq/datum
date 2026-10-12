# datum — Current State

**Branch:** `claude/datum-workflow-person-nmxqz4` | **Last updated:** 2026-10-12 | **Run:** `20261012-150046`

---

## Shipped

### Workflow runner core: run datum bundles outside Claude Code (2026-10-12, run 20261012-150046)

Epic `docs/epics/claude/datum-workflow-person-nmxqz4/` ("Workflow runner core: run
datum bundles outside Claude Code") reached merge commit
`5db34d5c497e23da23940b1c7fa00415948640db` (2026-10-12T13:11:11+00:00).
`epic_number` is `-1` in `closeout-data.json` (no GitHub issue number attached to
this run). 20/20 tasks completed (`say_do_ratio` 1.0, 0 `failed_terminal`), lanes
`DAT-1`..`DAT-20`, per `tasks.json` in the epic folder and `closeout-data.json`.

`git` block: 63 commits, +13139/-316 LOC (net +12823) across 154 files touched,
`git.warnings: []` (no `base_sha_fallback`). This is the first epic whose lanes
are all numbered with `DAT-` ids.

**What the epic did**, per `TICKET.md` and `SPEC.md` in the epic folder. The
design source named in the ticket is the homelab repo's `docs/plans/datum-on-pi.md`
(slices 1, 2, 3 and 8); this repo does not contain it.

- **Shell seam in `runBatch` (R1; DAT-1).** `skills/src/shared/sandbox.d.ts` declares
  an optional global `shell(script, {cwd, timeoutMs})`. `runBatch`
  (`skills/src/shared/agents.ts`) accepts `deps.shell`, falls back to
  `globalThis.shell`, runs `batchScript(steps)` through it and never calls
  `agentFn`. With no shell the Claude Code path is meant to be unchanged (but see
  review finding CORR-001 below).
- **Every `datum-cli` call goes through `runBatch` (R2; DAT-2..DAT-9).**
  `verifyCommitIndependently`, lane dep-merge, `datum-go` act-start and preflight
  checks, `datum-tdd-act` / setup / merge, `datum-validate`, `datum-closeout`, and
  the context-inline retries in `datum-plan`, `datum-properties` and
  `datum-refine` were moved onto `runBatch`. DAT-9 adds a repo-wide guard test
  that `batchCommandPrompt` is referenced outside tests only in `shared/batch.ts`
  and `shared/agents.ts`. Per QUESTIONS.md Q9 the acceptance grep was extended to
  `runCommandPrompt|contextInlineRetryPrompt|batchCommandPrompt`.
- **Runtime config (R6; DAT-10).** `readRuntimeConfig()` in
  `skills/src/shared/models.ts` parses the `.datum/config.json` `runtime` block
  (`kind`, `models`, `concurrency`, `priority`, `client`).
- **Runner (R3, R4, R5; DAT-11, DAT-15).** `skills/src/runtime/runner.ts` exports
  `runBundle`, supplies the sandbox globals (`agent`, `parallel`, `pipeline`,
  `phase`, `log`, `workflow`, `args`, `budget`) and loads nested bundles from
  `skillsDirs`. `skills/src/runtime/executor.ts` defines `StageExecutor`;
  `skills/src/runtime/fake-executor.ts` is the only executor shipped (no HTTP
  client, no pi executor).
- **Concurrency, metrics, output contract (R6, R7, R8; DAT-12, DAT-13, DAT-14,
  DAT-20).** `skills/src/runtime/semaphore.ts` keeps one semaphore per model id
  with FIFO order and agent-type affinity, and requests carry `X-Client` and
  `X-Priority` headers. `skills/src/runtime/metrics.ts` appends one line per
  executed request to `.datum/runs/<runId>/metrics.jsonl`.
  `datum/closeout/collect_token_metrics.py` reads that file and adds
  `per_agent_type`, `per_stage` and `cached_share` (Q1 answer). Stage replies are
  validated against `opts.schema`; an invalid reply is retried once on the next
  tier up. `STAGE_RESULT_SCHEMA`, `REFLECT_SCHEMA` and `SKEPTIC_SCHEMA` in
  `skills/src/shared/schemas.ts` now list `read_witness` (and for the stage
  result `files_written` and `test_exit_code`) as required.
- **`cli_call_bypassed_runbatch` guard and forced agent types (R4; DAT-16).** An
  `agent()` call with `agentType` `datum-cli` is rejected by name instead of
  reaching the executor; the runner forces agent types on (Q9 answer).
- **Real shell and end-to-end fixture (R10; DAT-17).**
  `skills/src/runtime/shell.ts` is the subprocess `nodeShell`;
  `skills/src/runtime/fixtures/fixture-go.js` and `fixture-child.js` exercise the
  runner through a real shell.
- **CLI (R9; DAT-18, DAT-19).** `scripts/build-workflows.sh` builds
  `skills/runtime/runner.js` as a second esbuild target; `datum workflow run <name>
  --args <file> [--config <path>]` (`datum/workflow_run.py`, wired in
  `datum/cli.py`) spawns `node` on it. The compiled runner is committed
  (`0227b6e`).

**Pipeline fixes made while dogfooding this epic** (commit subjects, outside the
ten requirements; several are called out as scope creep by the review below):
`datum/gate.py` vague-term scan ignores inline code spans and the properties
traceability check accepts every lane id shape (`49fd0e0`, `fdcf9f7`);
`lane-plan --renumber` forwarded by the CLI (`909d93a`); a runner-authored
`not_run` step row is treated as a refusal and retried once (`60ba20a`);
`datum init` with `agent_types_disabled` keeps agent types off (`f198fc0`); the
act-start batch retries once when the runner changes the lane plan digest
(`23176fc`); preflight tool check exits 0 with JSON when no `uv tool install`
exists (`e505f09`); lint fixes are committed by path rather than by the agent's
sentence (`52a43bf`); boot and preflight batches retry a prose reply once
(`ae060fc`); review report cells keep pipes in code spans (`0ba8afa`); a plan that
dropped PROPERTIES.md's integration lanes is refused (`5db34d5`); worktree merge
commits regenerate generated files (`d83344b`); `lane-plan` finds existing tests
that pin a lane's source text (`00ef99a`); a post-GREEN caliper gate in
`agent_loop` got tests (`1bdc87c`); the Python suite was made hermetic outside the
owner's workstation (`b2d2637`). Three `plan: amend` commits (`781efd7` DAT-6,
`d180d56` DAT-3 and DAT-8, `bfa7f5b` DAT-9, DAT-19 and DAT-20) changed lane
briefs after planning.

**Review.** Three review iterations are in the commit log
(`72b4740` 30 findings, `d9e960a` 29, `a424f9e` 22). The final
`REVIEW-REPORT.md` lists 22 unique findings, 1 high/critical (CORR-001, key
`8ed9e6a1`):

- High: CORR-001 (`skills/src/shared/batch.ts:190`) — the diff changes the hosted
  path (new prompt sentence in `batchCommandPrompt`, an authored-row branch in
  `parseBatchResult`, a wider `REFUSAL_RE`) against R1.5, R2.3 and the hosted-path
  NFR. Decided ACCEPT (see below).
- Medium: SEC-001 (`resolveRunId` / `--run-id` path traversal), PERF-001 (`nodeShell`
  unbounded stdout/stderr buffers), PERF-002 (shell batches bypass the
  semaphores), ARCH-001 (`MetricsOutcome` type lacks `invalid`).
- Low: SEC-002, SEC-003, SEC-004, PERF-003, PERF-004, ARCH-002..ARCH-005,
  CORR-002..CORR-008. Info: PERF-005 (coverage note).

No decision other than the CORR-001 ACCEPT lines below is recorded in
`REVIEW-RESPONSE.md`; the other 21 findings are undecided, not accepted.

<!-- review-decisions:start -->
## Review Decisions

- ACCEPT f9b971da (CORR-001 skills/src/shared/batch.ts:190): Intentional operator fix outside this epic's runner scope, committed on the epic branch while dogfooding (60ba20a). With agent types off, a generic batch runner declined a step and AUTHORED a row for it (exit_code null, not_run stderr), which parseBatchResult read as a real failure. The authored-row branch routes that to the existing one-retry refusal path, and the prompt sentence tells the runner never to author a row. Both are pinned by tests in batch.test.ts. R1.5's byte-identical prompt rule exists so the runner work does not change the hosted path by accident; this change is deliberate and fixes a hosted-path defect. Reverting it would bring the fabricated-row failure back.
- ACCEPT 8ed9e6a1 (CORR-001 skills/src/shared/batch.ts:190): Same finding as f9b971da (accepted above), re-keyed because review iteration 3 reworded it. The hosted-path batch prompt sentence, the authored-row branch in parseBatchResult and the REFUSAL_RE widening are one deliberate operator fix from 60ba20a for a defect found while dogfooding (a runner that declines a step and writes a fabricated not_run row). batch.test.ts pins the new prompt sentence and both parse outcomes. Kept, not reverted: reverting reintroduces the fabricated-row failure on the hosted path.
<!-- review-decisions:end -->

`brief_defects`: none reported (empty array). `platform`, `lane_tools`,
`gitnexus_diff`, `solutions`: not reported (`null` or empty in
`closeout-data.json`). `tasks.per_stage_retries` is `null`.

**Telemetry gap, still open.** `token_metrics.status` is `"no_state_available"`,
`collected: false`, reason "no state.db at `.datum/runs/20261012-150046/state.db`
or `.datum/state.db` (no producer writes one)" — the sole `collector_warnings`
entry. This epic's `metrics.jsonl` sink (R7) is a new, separate source the
collector now reads, but nothing in this run's data shows a run that produced one;
the `state.db` producer gap is unchanged.

### Prior State (run `20260908-052437`, 2026-09-08)

Monotonic repo-wide task ids (`DAT-NNN`) merged at
`a162b295488ddaf52bdcda25853f73f0f1fceb87` on branch `datum/monotonic-task-ids`
(22/22 tasks, 53 commits, +8952/-232). It introduced `datum/task_ids.py`,
`datum lane-plan --renumber`, integration lanes drawn from the same counter, and a
shared table-driven lane-id pattern (`assets/schemas/task.schema.json`). Its review
left two medium findings open: SEC-001 (`resolve_task_id_prefix()` in
`datum/task_ids.py:59` returns a config-supplied prefix unvalidated) and PERF-001
(`iter_committed_ids` at `datum/task_ids.py:116` spawns one `git show` per
committed epic id file). Nothing in this run's data confirms either was fixed.
Its CORR-001 (info) concerned SPEC R4 AC3 wording versus Assumption 8.

### Earlier State (through run `20260907-163917`)

State single source of truth merged at `14f8be37f7818881829297041dded862a978d4bd`
(26/26 tasks). Its open findings were: SEC-001 (`lane-steps.ts` `q()` shell-quoting
gap, a different SEC-001 from the task-ids one above), SEC-002 (`batch.ts`
`bash "$__f"` execution model), CORR-001/CORR-002 (scope-creep findings), CORR-003
(info, Requirement 10 has no pre-migration A/B snapshot), and deferred
QUESTIONS.md answers Q5 (schema versioning), Q6 (busy_timeout), Q7
(raise-on-missing). Prior sessions (Epics 1-23+, PRs #25-#56, Bug Squash #167,
Consumer-First Build-Order run `20260707-173926`) are in
`docs/epics/datum/integration-lanes/` and git history; their follow-ups FU-1,
FU-2, FU-5 and FU-6 are not confirmed resolved by any closeout data since.

---

## What's Next

**Priority 1 — Record decisions on the 21 undecided review findings** in
`REVIEW-RESPONSE.md` via `datum review-accept`, starting with the medium ones:
validate `runId` at the boundary in `resolveRunId` and in `collect_token_metrics.py`
(SEC-001, suggested pattern `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`), cap or spill
`nodeShell` output (PERF-001, SEC-004), route shell batches through a semaphore key
or state they are unbounded (PERF-002), and widen `MetricsOutcome` to
`'ok' | 'invalid' | 'error'` and drop the cast (ARCH-001, CORR-002).

**Priority 2 — Reconcile the scope-creep findings with SPEC.** CORR-003..CORR-008
name changes with no requirement behind them (`idempotent` and `retry: false`
options on `runBatch`, `--renumber` and `agent_types_disabled` in `datum/cli.py`,
the `jsonschema` dev dependency, gate changes in `datum/gate.py`, lane-steps and
validate-steps changes, `.datum/config.toml` and other housekeeping). Each needs
either a spec item or an explicit accept.

**Priority 3 — Hardening of the workflow-name and bundle loading.** SEC-002 and
SEC-003 (reject names with a path separator or `..` in `workflow({name})` and
`_find_bundle`; consider warning when a repo-local bundle shadows a packaged one).

**Priority 4 — Runner structure.** ARCH-002..ARCH-005: one neutral home for
`ShellFn`, move `main()` and executor wiring out of `runner.ts`, save and restore
`datumRuntime` like `shell` and `args`, pin the Python and TS runtime-kind lists
together.

**Priority 5 — Epics the ticket deferred.** The pi stage executor, role prompts,
external commits, `datum go` launcher, tracker and interview are named in the
ticket's Not This section as later epics; no HTTP client exists yet.

**Priority 6 — Node 24 pin.** Per QUESTIONS.md Q7, adding `.nvmrc` or `engines` for
Node 24 LTS is a follow-up outside this epic.

**Priority 7 — Root-cause the missing `state.db` producer** (`token_metrics` not
collected again this run; prior CURRENT_STATE counted five consecutive runs through
`20260908-052437`).

**Priority 8 — Carry forward** the task-ids epic's SEC-001 and PERF-001, the state
epic's SEC-001/SEC-002/CORR-001/CORR-002/CORR-003 and deferred Q5-Q7, and FU-1,
FU-2, FU-5, FU-6, none confirmed resolved.

---

## In Flight

This closeout ran on branch `claude/datum-workflow-person-nmxqz4`, not `main`;
the merge commit `5db34d5c497e23da23940b1c7fa00415948640db` is the branch `HEAD`.
Whether and when it lands on `main` is not confirmed by anything in this run's
data. The review gate (`datum review-accept`) has recorded decisions for CORR-001
only.

---

## Backlog

- 21 undecided findings from `REVIEW-REPORT.md` (see Priority 1 and 2)
- Pi executor, role prompts, launcher, tracker, interview (ticket "Not This")
- `.nvmrc` / `engines` for Node 24 (Q7)
- `token_metrics` / `state.db` producer gap
- Task-ids epic: SEC-001 (`task_ids.py:59`), PERF-001 (`task_ids.py:116`), CORR-001
  (info)
- State epic: SEC-001 (`lane-steps.ts` `q()`), SEC-002 (`batch.ts`), CORR-001,
  CORR-002, CORR-003, deferred Q5, Q6, Q7
- FU-1, FU-2, FU-5, FU-6 from run `20260707-173926`
