# datum — Current State

**Branch:** `datum/monotonic-task-ids` | **Last updated:** 2026-09-08 | **Run:** `20260908-052437`

---

## Shipped

### Monotonic repo-wide task ids (2026-09-08, run 20260908-052437)

Epic `docs/epics/datum/monotonic-task-ids/` ("Sequential repo-wide task numbers
(`DAT-NNN`) instead of per-epic `task-001`") reached merge commit
`a162b295488ddaf52bdcda25853f73f0f1fceb87` (`epic_number` reported as `-1` in
`closeout-data.json` — no GitHub issue number attached to this run). 22/22 tasks
completed (`say_do_ratio` 1.0, 0 `failed_terminal`) per
`docs/epics/datum/monotonic-task-ids/tasks.json`. The `lanes` array in
`closeout-data.json` lists 22 entries: 16 task lanes (`task-001`..`task-016`)
plus 6 integration lanes (`task-INT-1`..`task-INT-6`).

`git` block for this run reports 53 commits, +8952/-232 LOC (net +8720) across
95 files touched. No `base_sha_fallback` warning and no `collector_warnings`
entries in the `git` block this run (`git.warnings: []`).

**What the epic actually did**, per `docs/epics/datum/monotonic-task-ids/SPEC.md`
and `docs/epics/datum/monotonic-task-ids/TICKET.md`:

- New epics now get a repo-wide monotonic lane id (`<PREFIX>-<n>`, e.g. `DAT-142`)
  instead of restarting at `task-001` every time. `datum/task_ids.py` resolves
  `task_id_prefix` from `.datum/config.json`, deriving and persisting it once
  from the repo directory basename when absent (Requirement 1).
- `datum/task_ids.py`'s `iter_committed_ids` computes the next id as
  `max(existing) + 1` by scanning every committed `docs/epics/*/tasks.json` and
  `lane-plan.json` on the current branch via `git show` (Requirement 2) — old
  `task-\d+`/`task-INT-\d+` ids are excluded from that max, so the counter only
  advances over already-issued `<PREFIX>-\d+` ids.
  - **Known review gap (SEC-001, medium, unresolved):** `resolve_task_id_prefix()`
    (`datum/task_ids.py:59`) returns a config-supplied `task_id_prefix` from
    `.datum/config.json` unvalidated — only the *derived* fallback path enforces
    a `[A-Za-z]{2,3}` shape. A malformed or shell-metacharacter-bearing prefix
    from an untrusted repo's config is accepted verbatim and only ever rejected
    indirectly, if a later JSON-schema check happens to run before the id
    reaches a shell-command consumer (`lane-steps.ts`'s `setupSteps()`). Per
    `docs/epics/datum/monotonic-task-ids/REVIEW-REPORT.md`.
  - **Known review gap (PERF-001, medium, unresolved):** `iter_committed_ids`
    spawns one `git show` subprocess per committed epic id file (~26 files
    currently), called twice per plan execution (~52 spawns/plan) — an N+1
    subprocess pattern (`datum/task_ids.py:116`). Per REVIEW-REPORT.md.
- `datum/task_renumber.py` adds a deterministic post-decompose step
  (`datum lane-plan --renumber`) that rewrites the decomposer's placeholder
  `task-NNN` ids to `<PREFIX>-<n>` in dependency-topological order, rewriting
  every `depends_on` reference to match (Requirement 3). The plan phase passes
  `--renumber` only for a fresh epic (no committed `lane-plan.json`); a bare
  `datum lane-plan` on an existing epic never renumbers.
- `datum/integration_invariants.py`'s `build_lane_plan` now draws integration
  lane ids from the same monotonic counter as task lanes for a new epic — no
  `task-INT-` shape is emitted for new epics; integration lanes are
  distinguished solely by the existing `kind: integration` field (Requirement 4).
  Existing `task-INT-\d+` epics continue to validate unchanged.
- A single shared, table-driven id-pattern definition (rooted in
  `assets/schemas/task.schema.json`, consumed by `datum/id_pattern.py` on the
  Python side and `skills/src/shared/lane-id-pattern.ts` on the TS side) now
  accepts `task-\d+`, `task-INT-\d+`, and `[A-Z]{2,6}-\d+`, replacing the
  scattered literal regexes previously duplicated across 12 Pydantic schema
  files, `datum/gate.py`, and `skills/src/shared/lane-steps.ts` (Requirement 5).
  Both a Python and a TypeScript test assert `task-1`, `task-INT-1`, and
  `DAT-142` pass while `DAT142`, `dat-142`, and `DATUM-142` fail
  (`tests/test_id_pattern_shared.py`, `tests/test_id_pattern_ts_parity.py`,
  `skills/src/shared/lane-id-pattern.test.ts`).
- `datum/gate.py`'s `task_id_collision` check (already present as a halt code
  before this epic, per commit history) is confirmed to detect two epics on
  different branches independently claiming the same `<PREFIX>-<n>` id, and
  `docs/epics/datum/monotonic-task-ids/PROPERTIES.md` records the invariant
  matching rule fix so a renumbered integration lane is matched to its
  invariant row by invariants, not by id (commit `ced04fa3`, II-005).
- Every existing epic already in `docs/epics/` at ship time continues to
  validate unchanged under `datum lane-plan --validate` (Requirement 7) —
  `tests/test_existing_epics_still_validate.py` covers this; nothing in this
  epic's diff rewrites a committed `task-NNN`/`task-INT-N` id.
- End-to-end propagation (Requirement 8) — a `DAT-<n>`-shaped lane id now
  reaches branch name, worktree dir, commit prefixes, `Datum-Lane` trailer, and
  filed-issue titles unchanged, per
  `tests/test_task_id_propagation_end_to_end.py` and task-014's ownership of
  `datum/github_issues.py` (issue titles carry the lane id).
- Along the way, two dead schema copies were removed
  (`datum/assets/schemas/task.schema.json`,
  `datum/assets/schemas/tasks.schema.json` — `assets/schemas/task.schema.json`
  is now the one consumed source of the lane id regex, commit `60643b21`), and
  the runtime-artifact gate no longer flags a test's `repo_root` fixture
  (commit `f7562448`), and a truncated-batch-step-array retry path was added
  for the TS Workflow pipeline (commit `f60409a3`, `#539`) as a lint/gate fix
  discovered mid-epic (commit `63d78085` also lint-fixed a prior Validate-phase
  run, `#519`).

Review closed with 3 findings (0 high/critical) in
`docs/epics/datum/monotonic-task-ids/REVIEW-REPORT.md`: SEC-001 (medium,
unvalidated `task_id_prefix` boundary input, described above), PERF-001
(medium, N+1 `git show` subprocess pattern in `iter_committed_ids`, described
above), CORR-001 (info, a documented and SPEC-sanctioned self-contradiction
between R4 AC3's literal wording and Assumption 8's addendum — not a defect,
just an unclear cross-reference worth tidying).

<!-- review-decisions:start -->
No review decisions recorded yet; `datum review-accept` will update this line.
<!-- review-decisions:end -->

`brief_defects`: none reported (empty array). `platform`/`lane_tools`: not
reported (`null`/empty array in `closeout-data.json`). `gitnexus_diff`/
`solutions`: not reported (`null`).

**Telemetry gap — still open, unrelated to this epic.** `token_metrics.status`
is `"no_state_available"`, `collected: false`, reason: "no state.db at
`.datum/runs/20260908-052437/state.db` or `.datum/state.db` (no producer writes
one)" — the sole `collector_warnings` entry this run. This is the same
underlying gap flagged in the prior closeout
(`docs/epics/datum/state-single-source-of-truth/`, run `20260907-163917`) as
"Priority 1" and remains open; this epic did not touch it.
`tasks.per_stage_retries` is `null` again this run.

### Prior State (through 2026-09-07, run `20260907-163917`)

State single source of truth merged at `14f8be37f7818881829297041dded862a978d4bd`
on branch `datum/state-single-source-of-truth` (26/26 tasks). Whether that merge
reached `main` is not confirmed by anything in this run's `closeout-data.json`;
this run's own branch is `datum/monotonic-task-ids`, also not `main`. Two review
findings from that epic remain open per its own carried-forward backlog:
SEC-001 (`lane-steps.ts`'s `q()` shell-quoting gap — a **different** SEC-001
than this epic's `task_ids.py` finding above; both are open, do not conflate
them) and SEC-002 (`batch.ts`'s `bash "$__f"` execution model).

### Prior Sessions (Epics 1–23+, PRs #25–#56, Bug Squash #167; Consumer-First
Build-Order, run `20260707-173926`)

See `docs/epics/datum/integration-lanes/` and git history for detail. Follow-ups
FU-1, FU-2, FU-5, FU-6 from that run are not confirmed resolved by anything in
this run's `closeout-data.json` and are carried forward below.

---

## What's Next

**Priority 1 — SEC-001 (this epic): validate `task_id_prefix` at the config
boundary.** `resolve_task_id_prefix()` in `datum/task_ids.py:59` returns an
unvalidated config-supplied prefix verbatim; only the derived-prefix fallback
path enforces a shape. Fix: validate `existing` against the same
`[A-Za-z]{2,3}`-derived shape (or the shared `laneId` prefix rule) and raise
`TaskIdPrefixError` immediately on mismatch, per REVIEW-REPORT.md's suggestion.

**Priority 2 — PERF-001 (this epic): batch the `git show` scan.** Replace the
per-path `git show` loop in `iter_committed_ids` (`datum/task_ids.py:116`) with
a single `git cat-file --batch` call, cutting ~52 subprocess spawns per plan
down to O(1).

**Priority 3 — root-cause the missing `state.db` producer.** `token_metrics`
has failed to collect again this run (fifth consecutive run per the state
epic's own count: `20260707-173926`, `20260906-163354`, `20260907-022030`,
`20260907-163917`, now `20260908-052437`). Still no TS Workflow producer writes
lane/stage/retry telemetry into `state.db`; out of scope for this epic.

**Priority 4 — carry forward the state-single-source-of-truth epic's open
findings.** SEC-001 (`lane-steps.ts` `q()` shell-quoting gap, distinct from
this epic's SEC-001), SEC-002 (`batch.ts` `bash "$__f"` blast-radius widening),
CORR-001/CORR-002 (scope-creep review findings needing their own review
coverage) — none confirmed resolved by this run's data.

**Priority 5 — carry forward FU-1/FU-2/FU-5/FU-6 from run `20260707-173926`**
(review-finding verification for Consumer-First Build-Order, the untracked
36-commit hardening pass, GitNexus live-MCP capture, R1–R10 verification) —
nothing in this run's data confirms these were addressed.

**Priority 6 — CORR-001 (this epic, info-only, no action required for merge).**
Tidy SPEC.md's R4 AC3 wording so it explicitly cross-references Assumption 8's
addendum instead of reading as a literal contradiction.

---

## In Flight

This closeout ran on branch `datum/monotonic-task-ids`, not `main`. The merge
commit `a162b295488ddaf52bdcda25853f73f0f1fceb87` recorded in
`closeout-data.json` matches this branch's current `HEAD`; whether/when it
lands on `main` is not confirmed by anything in this run's data.

---

## Backlog

Carried from prior state where unresolved, plus this epic's own open findings:
- SEC-001 (this epic): unvalidated `task_id_prefix` config input in
  `datum/task_ids.py:59` (see Priority 1)
- PERF-001 (this epic): N+1 `git show` subprocess pattern in
  `iter_committed_ids` (see Priority 2)
- CORR-001 (this epic, info): SPEC.md R4 AC3 wording vs. Assumption 8 (see
  Priority 6)
- `token_metrics`/`state.db` producer gap — five consecutive runs now, root
  cause still open (see Priority 3)
- SEC-001 (state epic, `lane-steps.ts` `q()` shell-quoting — distinct from this
  epic's SEC-001 above) and SEC-002 (`batch.ts` blast-radius widening) — carried
  from run `20260907-163917`, not confirmed fixed
- CORR-001/CORR-002 (state epic): scope-creep review findings needing their own
  review coverage — carried from run `20260907-163917`
- CORR-003 (state epic, info only): Requirement 10's "unchanged behavior" AC
  has no real pre-migration A/B snapshot
- Deferred QUESTIONS.md answers from the state epic (Q5 schema versioning, Q6
  busy_timeout, Q7 raise-on-missing) — explicitly out of that epic's
  implemented scope
- Review-finding verification for Consumer-First Build-Order (FU-1, run
  `20260707-173926`)
- Retroactive mini-closeout for the untracked 36-commit hardening pass (FU-2,
  run `20260707-173926`)
- GitNexus MCP live-during-run requirement so `gitnexus_diff` impact detail
  populates (FU-5, run `20260707-173926`; `gitnexus_diff` is `null` again this
  run)
- R1–R10 verification, Bug Squash Round 2 (FU-6, run `20260707-173926`)
- git-stat base-SHA scoping — not applicable this run (`git.warnings: []`, no
  `base_sha_fallback` flagged), but the prior state epic's scoping concern
  remains relevant to any future closeout run against a branch with a wide
  merge-base
