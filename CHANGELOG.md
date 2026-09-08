# Changelog

All notable changes to DATUM are documented here.

## [State Single Source of Truth] — 2026-09-07 (run 20260907-163917)

### Added

Epic `docs/epics/datum/state-single-source-of-truth/` ("Unify `.datum/state.json`
readers/writers behind one db-backed accessor") merged at
`14f8be37f7818881829297041dded862a978d4bd`. 26/26 tasks completed (`say_do_ratio`
1.0, 0 `failed_terminal`) per
`docs/epics/datum/state-single-source-of-truth/tasks.json` (`task-001`..`task-012`,
`task-INT-1`..`task-INT-14`).

`git` block: 167 commits, +17812/-1537 LOC (net +16275) across 269 files —
flagged by the collector itself as `base_sha_fallback: merge-base with
origin/main; statistics may span more than the epic`, and confirmed spanning
several prior, already-closed-out epics (integration-lanes-2, sweep2-closeout,
sweep3-panel, sweep-refine, sweep-ts, prompt-refactor, and others). Treat the
LOC/file totals as an upper bound, not this epic's true diff size.

`datum/state.py`'s db-backed `load_state()`/`save_state()`/`update_state()` is
now the sole canonical live-state accessor; `.datum/state.json` as a **live
write-through cache is dropped entirely** (decision recorded in
`docs/architecture/state-store.md`). Seven independent JSON-only implementations
(`spec_drift_detector.py`, `pr_comment_monitor.py`, `status_render.py`,
`rollback.py`, `no_diff_guard.py`, `pipeline_scheduler.py`, `path_utils.py`) and
the bare-`Path` readers in `report_bug.py`/`archive.py` migrated onto the
canonical accessor. `datum/migrate.py` is retargeted as a one-shot legacy
`state.json` importer. Exactly two permanent documented exceptions remain:
`datum/memory/corpus_sql.py` (read-only SQL `ATTACH` of `state.db`) and
`datum-tui/data.py` (reads `state.db` directly via stdlib `sqlite3`, by design
avoids importing the `datum` package). `datum/closeout/collect_tasks.py` and
`collect_token_metrics.py` now emit an explicit `no_state_available` sentinel
instead of a bare `null`, closing FU-4 from run `20260707-173926`.

### Fixed

- `datum/worktree_manager.py`: a reused lane worktree branch is now rebased
  onto the batch's named base (#341) — flagged by review as scope-creep
  (CORR-002) relative to this epic's SPEC, landed anyway.
- Skills/TS workflow layer: agent-type fallback, read-only retry guard, review
  lens read budget/retry, batch runner hardening (bash-executed step files,
  `batch_incomplete`/`batch_timeout` handling, guard-row retries) — also
  flagged as scope-creep (CORR-001) relative to this epic's SPEC.

### Known issues (from review, not yet fixed)

- **SEC-001** (medium): `skills/src/shared/lane-steps.ts`'s `q()` quoting
  helper only escapes double-quote characters; `structuralDeliverableSteps()`
  builds shell commands from task-plan-derived file paths, so a path
  containing `$(...)` or backticks is executed as a shell command.
- **SEC-002** (low): `batch.ts` switched from sourcing (`. "$__f"`) to
  executing (`bash "$__f"`) the generated step script, widening SEC-001's
  blast radius.
- **CORR-003** (info): Requirement 10's "unchanged behavior before/after
  migration" acceptance criterion has no real pre-migration snapshot to A/B
  against, since the pre-migration code path no longer exists in the tree.

Full findings: `docs/epics/datum/state-single-source-of-truth/REVIEW-REPORT.md`.

## [Integration Lanes 2] — 2026-09-07 (run 20260907-022030)

### Added

Epic `docs/epics/datum/integration-lanes-2/` ("slice 2a — an integration lane runs
RED-only, end to end", ticket commit `2dd8143e`) merged at
`c824e42f03b5cacff0059f533e4d663649d1d1fd`. 9/9 tasks completed (`say_do_ratio` 1.0, 0
`failed_terminal`) per `docs/epics/datum/integration-lanes-2/tasks.json`
(`task-001`..`task-004`, `task-INT-1`..`task-INT-5`).

`git` block: 53 commits, +4423/-111 LOC (net +4312) across 71 files, `92f2dd8a`..
`c824e42f`.

Review closed with two operator ACCEPT decisions recorded verbatim in
`docs/epics/datum/integration-lanes-2/REVIEW-RESPONSE.md`:

- **ACCEPT `2a3ee4a4`** (ARCH-001, `datum/integration_invariants.py:150`): "The SPEC's
  literal mechanism (parse invariant ids from acceptance-criteria text at runtime) is
  forbidden by the existing tripwire in `datum-tdd-act-lane.test.ts`: runLane never
  reads criteria text, they travel by file to the stage agents. GREEN diagnosed exactly
  that and stopped (`green_blocked_needs_write`). The invariants field is the smallest
  producer that already exists at synthesis time, one line in `derive_integration_lanes`
  and one allowlist entry in the digest; the derivation logic of slice 1 is untouched.
  Documented in `docs/FLOW.md` Closed ('A plan handed a lane a criterion whose input had
  no producer'). SPEC Assumption 5 will be amended at closeout."
- **ACCEPT `d41bdc38`** (ARCH-002, `datum/gate.py:1123`): "`plan_not_sliced` landed on
  dev (`92f2dd8a`, `c9bccb59`) before this epic branched and reached it through the dev
  history, not through this slice's lanes; the review base is the merge-base with main,
  so dev's own commits appear in the diff (same conflation FLOW.md records for closeout
  statistics, #482). Not a change of this slice; slice 2c still owns turning the warning
  into a halt."

### Known Gaps

- **Telemetry gap (repeat of FU-4, run `20260707-173926`; also seen run
  `20260906-163354`).** `token_metrics.collected` is `false`: "no state.db at
  `.datum/runs/20260907-022030/state.db` or `.datum/state.db` (no producer writes one)"
  (logged in `collector_warnings`) — third consecutive run with this gap.
- `gitnexus_diff` and `solutions` are `null`; `platform` is `null`; `lane_tools` is
  empty; `brief_defects` is empty — none reported by this run's collectors.
- This run's `git` block does not show the multi-epic scope-conflation pattern flagged
  in the prior two closeouts (FU-3 / repeat) — the listed commit range reads as scoped
  to this epic.

---

## [Integration Lanes] — 2026-09-06 (run 20260906-163354)

### Added

Epic ticket `9e6c7aaf` (`docs/epics/datum/integration-lanes/`, "slice 1 — Properties
emits tagged cross-task invariants, Plan schedules RED-only INT lanes") merged at
`ff60e33c56cb2dac886372ffcfc03029e9d737cd`. 9/9 tasks completed (`say_do_ratio` 1.0, 0
`failed_terminal`) per `docs/epics/datum/integration-lanes/tasks.json`.

Review ran four iterations (`REVIEW-REPORT.md` passes of 12, 11, 6, 9, and 2 findings)
and closed with three operator ACCEPT decisions recorded verbatim in
`docs/epics/datum/integration-lanes/REVIEW-RESPONSE.md`:

- **ACCEPT `d3246c28`** (ARCH-003, `datum/gate.py:19`): "Module-level imports of
  `integration_invariants` in `gate.py` are the same pattern as every other gate helper
  import in that file; the coupling is real and intended, and a lazy import would only
  hide an ImportError until the plan gate runs."
- **ACCEPT `cad4e34f`** (CORR-001, `datum/lane_plan_digest.py:56`): "SPEC AC4.1
  conflicts with its own Backward-compatibility row (pre-slice plans must digest
  byte-identically) and with the shipped test
  `test_ac1_properties_path_none_is_byte_identical_to_pre_slice_output`; every
  consumer already treats an absent kind as task (AC4.3, AC9.2), so no default is
  synthesised."
- **ACCEPT `be2382b4`** (ARCH-001, `datum/gate.py:1087`): "The NFR bounds file reads
  (one extra linear pass over PROPERTIES.md and tasks.json), and `gate_plan` does
  exactly that; `derive_integration_lanes` then works in memory on a table of at most
  a few dozen rows. Verifying `depends_on` against the same derivation the planner ran
  is the point: a second grouping implementation in the gate could drift from the
  planner and pass a plan the planner would not have produced."

### Known Gaps

- **Git-stat scope conflation (repeat of FU-3, run `20260707-173926`).**
  `closeout-data.json`'s `git` block reports 513 commits, +51063/-8320 LOC across
  ~240 files, spanning far more than this epic — back through unrelated prior epics
  to `52655981 fix(datum-go): preflight tool-check false-positives on non-datum
  target repos (#378)`. This epic's own scope runs from ticket commit `9e6c7aaf`
  through review-accept commit `2b83f804`, roughly 80 of the 513 listed commits. The
  base-SHA resolution gap flagged in the prior closeout is still unresolved.
- **Telemetry gap (repeat of FU-4, run `20260707-173926`).** `token_metrics.collected`
  is `false`: "no state.db at `.datum/runs/20260906-163354/state.db` or
  `.datum/state.db` (no producer writes one)" (logged in `collector_warnings`).
- `gitnexus_diff` and `solutions` are `null`; `platform` is `null`; `lane_tools` is
  empty — none reported by this run's collectors.

---

## [Consumer-First Build-Order] — 2026-07-07 (run 20260707-173926)

### Added

Epic ticket (GitHub issue #264, `docs/epics/datum/consumer-first-build-order/`) gave
`datum-plan` a real build-order analysis step instead of inferring `depends_on` purely
from SPEC narrative. Merge `9241846` on top of base `7be6c6f082cd`; epic's own scope was
30 files, +1753/-18 LOC (`ef25421`..`9241846`):

- **`feat(shared/models)`**: `context_files: []` added to `DEFAULT_CONFIG` so a project's
  `.datum/config.json` can declare build-constraint docs (e.g. `BUILD-ORDER.md`)
- **`feat(shared/utils)`**: `TaskPacket.upstream_source` + `resolveUpstreamSource()` —
  reads the full source of a lane's transitive `depends_on` implFiles from the worktree
  (excluding testFiles), fails fast if a required upstream file is missing on disk
- **`feat(datum-tdd-act-lane)`**: RED/GREEN/REFACTOR `buildPacket` calls now carry
  `upstream_source` so act-lane agents see real upstream interfaces instead of
  hallucinating them
- **`feat(shared/graph)`**: new pure `detectCycles()` module — detects direct and
  transitive dependency cycles over `{id, depends_on}` task graphs
- **`feat(datum-plan)`**: calls `detectCycles` before writing `lane-plan.json` (halts
  loud on a cycle instead of emitting one), reads `context_files` into the decompose
  prompt, and `plan-decompose.md` gained a "BUILD-ORDER / IMPORT ANALYSIS CHECK" and
  "PROJECT BUILD CONSTRAINTS" section
- **`fix(datum-plan)`**: `context_files` reader initially used `node:fs` directly and
  broke the build; switched to the `agent()` tool convention (`9241846`, fixed inline
  during the run)

One review pass returned 6 findings (2 high, 4 medium) — `PERF-001` N+1 `git branch -d`
subprocess calls in `worktree_manager.py::housekeep_epic()`, `ARCH-001` bidirectional
logic in `pathBoundaryMatch()` contradicting its documented one-directional contract
(correctness risk, not just style), `PERF-002`/`PERF-003` O(n·m) `.some()` loops in
`verifyFileOwnership`/`findScopeGaps`, `ARCH-002` `WalkthroughResult` subclassing `Path`,
`ARCH-003` `contextlib.redirect_stdout` coupling in `cli.py::init()`. None are confirmed
resolved in the commit log after the review commit (`5f50fec`) — see Known Gaps.

### Known Gaps

- **Un-closed-out intermediate work.** This run's `closeout-data.json` git stats span
  back to base `badb2a9bceb9` — 68 commits, +4462/-461 LOC across 64 files — which
  conflates this epic with 36 commits of prior pipeline-hardening work
  (`7be6c6f082cd`..`ef25421`) that never went through its own Refine → Plan → Review →
  Closeout cycle (auto-repair of lane scope gaps #325/#334/#335, per-lane
  `test_command` preflight #326/#307, RED-stage retry #333, count-gate crash guards
  #315, CLI-flag recovery #319, three review passes converging 12 → 9 → 6 findings, and
  more). Recommend a retroactive mini-closeout — see `follow-ups.json`.
- The 6 review findings above are not confirmed fixed — recommend explicit
  verification before treating this epic as fully closed.
- `tasks`, `solutions`, `token_metrics` in `closeout-data.json` were again empty/zero,
  repeating the same telemetry-capture gap flagged in the prior closeout's
  `follow-ups.json` (FU-2) — still unresolved across two consecutive runs.
- `gitnexus_diff.available` is `true` but carries no impact-detail payload; MCP was not
  live during data capture.

---

## [Bug Squash Round 2] — 2026-07-07 (run 20260707-093851)

### Fixed

Epic targeted ten self-filed bugs from epic #282 (issues #265, #269, #270, #213, #301,
#302, #303, #304, #307, #309 — see `docs/epics/datum/bug-squash-round-2/SPEC.md`).
21 commits merged to `main` at `7be6c6f082cd`, 55 files touched, +2556/-203 LOC.
During self-hosted execution the pipeline encountered its own bugs mid-run and fixed
them inline rather than only landing the ten original targets:

- **`fix(pipeline)`**: replaced ambiguous `<branch>` placeholder with real shell
  substitution (`7f3f486`)
- **`fix(pipeline)`**: required programmatic JSON construction for large file-content
  embeds, avoiding string-interpolation breakage (`c271035`)
- **`fix(pipeline)`**: resolved safety-classifier blockers in `datum go` run (`0a0b4fd`)
- **`fix(pipeline)`**: seed `resolvedBranch`/`runId` from prior pipeline-state on resume
  (`b8e0599`)
- **`fix(build)`**: added `@types/node`, excluded `.test.ts` from workflow entry points
  (`03da9ec`)
- **`fix(worktree)`**: reuse existing lane branch on worktree-add collision (`f68a656`)
- **`fix(worktree)`**: deregister stale worktree when lane branch is checked out
  elsewhere (`cb282f9`)
- **`fix(lane)`**: path-boundary-aware `verifyFileOwnership`, exported from
  `shared/utils` (`35a7bd6`)
- **`docs`**: recorded CLI-only mandate and pipeline overview updates for #265/#270/#213
  (`c366d03`)

Four review passes ran during the epic, converging from 9 findings → 7 → 6 → 4
(`2d5f424`, `9ce97a4`, `30689a7`, `7be6c6f`).

### Known Gaps

- This run's closeout telemetry (`tasks`, `solutions`, `brief_defects`, `token_metrics`
  in `closeout-data.json`) was empty/zero, so per-task completion status against the
  original R1–R10 requirements could not be confirmed. Treat R1–R10 as **unverified**
  pending a follow-up check (see `follow-ups.json`).
- GitNexus impact-detail collection was unavailable this run (MCP not live), so no
  symbol-level blast-radius data exists for this merge (base `badb2a9b` → merge
  `7be6c6f0`).

---

## [Bug Squash #167 Act Phase — Partial] — 2026-06-14 (run 20260614-161954)

### Fixed

Act phase executed against `bug-squash-167` plan. 2 of 6 tasks completed, 1 partial. Review returned 0 findings.

**task-1 — `make_function_name()` hyphens in identifiers (COMPLETED)**
- `datum/skeleton_creator.py`: Added `.replace('-', '_')` after `slugify()` call in `make_function_name()`
- Fixes: generated Python/Swift test function names are now valid identifiers for any AC text containing hyphens
- Commit: `43be12e`

**task-4 — Act phase path resolution and error logging (COMPLETED)**
- `skills/src/datum-go.ts`: All `scriptPath` values converted from bare relative strings to `skillPath()`-resolved absolute paths
- Config read early (before phase loop) so `skillPath()` is available across all phases
- Arg parsing made resilient: freetext and issue-number strings now accepted (no longer throws on non-JSON input)
- Debug log added at Act phase entry: `shouldRun act=`, `startIdx=`, `haltedAt=`, `activePhases=`
- `skills/datum-go.js`: Rebuilt from updated TS source
- Fixes: `datum go` no longer produces `ENOENT` errors when CWD != repo root (#165)
- Commit: `43be12e`

**task-6 — JS rebuild (PARTIAL)**
- `skills/datum-go.js`: Updated with task-4 scriptPath fixes
- `skills/datum-tdd-act-lane.js`: Rebuilt with `DEFAULT_CONFIG.skills_dir` addition only — task-5 grep fix not included
- Commit: `43be12e`

**Bonus: Remove phantom phases from datum-tdd-act**
- `skills/src/datum-tdd-act.ts` / `skills/datum-tdd-act.js`: Removed duplicate phase-display entries
- Child workflows (datum-tdd-act-setup, datum-tdd-act-lane, datum-tdd-act-merge, etc.) own their own phase display — orchestrator no longer echoes phantom phases
- Commit: `a34f8af`

### Not Completed

- **task-2**: `datum/lane_plan.py:356` — file-conflict dependency edges not wired (`_` still discards conflicts)
- **task-3**: `datum/skeleton_creator.py:467,556,579` — `Path.write_text()` still overwrites; append-or-create not implemented
- **task-5**: `datum-tdd-act-lane.ts:174` — grep pattern `'^+def test_'` unchanged; class-based test methods undercounted

---

## [Bug Squash #167 — Closeout] — 2026-06-14 (run 20260614-154341)

### Closed Out (planning complete, act phase queued)

Epic `bug-squash-167` closed out with full planning artifacts committed. Act phase not executed — 6 tasks remain queued and ready to run with `datum act`.

**Artifacts committed to `docs/epics/datum/bug-squash-167/`:**
- `TICKET.md` — 7 bugs (4 critical, 3 high) structured for act dispatch
- `SPEC.md` — requirements with per-bug acceptance criteria and symbol-level call sites
- `TASKS.md` / `tasks.json` — 6-task plan (7 bugs collapsed into 6 tasks, task-6 is JS rebuild)
- `lane-plan.json` — 6 lanes, topological order with dependency edges (task-6 depends on task-4 + task-5)
- `PROPERTIES.md` — safety and liveness properties for each fix
- `REVIEW-REPORT.md` — 10 findings (2 critical, 2 high, 4 medium, 1 low)
- `RETRO.md` — metrics, observations, defect table, follow-ups
- `routing.json` — pipeline route classification

**Follow-ups filed:**
- Run act phase: 6 tasks queued at `docs/epics/datum/bug-squash-167/lane-plan.json`
- Post-skeleton write verification (trust-without-verify defect in preflight)
- Fix traceability comments in `tests/test_ruff_precheck.py:3` and `tests/test_mypy_precheck.py:3`
- Complete truncated docstring at `tests/test_ruff_precheck.py:9`
- Fix CORR-001/CORR-002: restore 5 missing RED skeletons in ruff and mypy test files

---

## [Bug Squash #167] — 2026-06-14 (run 20260614-145327)

### Planned (act phase not executed)

**Epic:** `bug-squash-167` — ticket and review complete. 7 pipeline friction bugs catalogued and reviewed. Implementation not yet run.

- **TICKET.md**: 7 bugs (4 critical, 3 high) filed as a structured fix epic. Root causes span skeleton generation, lane orchestration, test-count gate, and path resolution.
- **REVIEW-REPORT.md**: 10 findings (2 critical, 2 high, 4 medium, 1 low). Key finding: `skeleton_written=True` logged for all 6 ACs in preflight packets but only 1 RED skeleton committed to each of `tests/test_ruff_precheck.py` and `tests/test_mypy_precheck.py`.

### Review Findings (10 total)

| ID | Severity | File | Description |
|---|---|---|---|
| ARCH-001 | high | tests/test_mypy_precheck.py:3 | Traceability comment uses hyphenated name; actual function uses underscores |
| ARCH-002 | high | tests/test_ruff_precheck.py:3 | Same traceability mismatch as ARCH-001 |
| ARCH-003 | medium | datum/skeleton_creator.py:337 | make_function_name() no language-aware sanitization after slugify() |
| ARCH-004 | medium | datum/skeleton_creator.py:467 | write_text() with no existence check — overwrites on multi-lane (bug #160 root) |
| ARCH-005 | medium | docs/epics/datum/bug-squash-167/TICKET.md:14 | bug #163 exposes tight coupling between plan output and skeleton consumption |
| CORR-001 | critical | tests/test_ruff_precheck.py:6 | Only 1 of 6 RED skeletons present — AC1-AC5 absent despite preflight logging skeleton_written=True |
| CORR-002 | critical | tests/test_mypy_precheck.py:6 | Same as CORR-001 — AC1-AC5 absent from mypy test file |
| CORR-003 | medium | tests/test_ruff_precheck.py:3 | Traceability comment still references pre-fix hyphenated function name |
| CORR-004 | medium | tests/test_mypy_precheck.py:3 | Same hyphenated traceability comment as CORR-003 |
| CORR-005 | low | tests/test_ruff_precheck.py:9 | Docstring truncated — missing `, errors: [] }` from full AC text |

---

## [Fail-Fast Validation Epic] — 2026-06-14 (run 20260614-141951)

### Planned (act phase not executed)

**Epic:** `fail-fast-validation` — full spec, task plan, properties, and review completed. Implementation not yet run.

- **SPEC.md**: deterministic ruff + mypy pre-check gate inside `runLane`, inserted after GREEN writes and before pytest. Fail-fast ordering: ruff → mypy → pytest. Structured error passback into GREEN retry with model escalation to `deep`.
- **TASKS.md / tasks.json / lane-plan.json**: 3-task plan with dependency graph (task-1 → task-3, task-2 → task-3). Estimated ~125 LOC across `skills/src/datum-tdd-act-lane.ts` and 3 new test files.
- **PROPERTIES.md**: 12 safety properties, 6 liveness properties, 4 ordering properties, 2 observability properties.
- **REVIEW-REPORT.md**: 18 findings (2 critical, 8 high). CORR-010 (critical): primary deliverable absent — implementation must be completed in next session.

### Review Findings Filed (18 total)

Key issues from `docs/epics/datum/fail-fast-validation/REVIEW-REPORT.md`:

- CORR-010 (critical): ruff+mypy gate absent from `datum-tdd-act-lane.ts` — primary deliverable not implemented
- CORR-001 (critical): Kotlin language detection broken — `build.gradle.kts` in java markers with no Kotlin guard
- SEC-001 (high): `DATUM_PROJECT_DIR` path traversal via unvalidated `os.chdir()`
- PERF-001/PERF-002 (high): O(n×m) dependency filtering via `Array.includes()` — convert to Set
- CORR-003/CORR-004/CORR-005/CORR-006 (high): detect.py and cli.py correctness defects

---

## [Pipeline Infrastructure Session] — 2026-06-14 (run 20260614-132742)

### Added

- **`datum-route` workflow**: classifies specs into pipeline routes (feature/hotfix/patch/epic) using a model-agnostic tier system. Route drives model selection for every downstream phase.
- **`datum-awake` workflow**: scans the codebase, distills key architecture context, and injects an agent preamble into all downstream agents. Keeps LLM context grounded in the actual repo.
- **`datum-go` orchestrator**: chains all 7 datum workflows end-to-end (route → awake → refine → plan → properties → act → closeout). Single entry point for the full SDLC.
- **Full TS workflow pipeline**: refine, plan, properties, validate, review, and closeout now all ship as esbuild-compiled self-contained JS. Zero Node.js module resolution at runtime.
- **`shared/models.ts`**: centralized model tier definitions (fast/balanced/deep) and tier-selection logic. Replaces scattered hardcoded model strings across workflows.
- **Prompt templates**: `route-classify.md`, `awake-scan.md`, `awake-distill.md`, `agent-preamble.md`, `agent-preamble-full.md`, `util-detect-branch.md` added to `skills/src/prompts/`.
- **TICKET template extraction**: `datum-closeout` now generates a typed TICKET.md for the next epic using headroom integration and an append protocol.
- **Closeout self-archiving**: root pipeline artifacts (TASKS.md, lane-plan.json, tasks.json, SPEC.md, TICKET.md, PROPERTIES.md) auto-archived to `docs/epics/<branch>/` on closeout.

### Changed

- **`parseAgentJson`**: now handles code fences, partial JSON, and phantom phases gracefully — no more parse panics on mildly malformed agent output.
- **Pipeline hardening**: verify gate enforces GREEN before merge; file ownership tracking in PreToolUse hook; `gate --approve` for manual overrides; yolo mode for CI; SKILL.md trimming to reduce prompt token overhead.
- **wave_builder**: cycle detection and structural validation run before act dispatch — catches malformed lane plans before committing to a TDD run.

### Fixed

- **Phantom `datum-go` phases**: removed ghost phases that appeared in the pipeline route and caused spurious agent invocations.
- **lint violations**: ruff violations in `tests/test_github_issues.py` skeleton fixed.

### Review (23 findings — 7 high/critical)

See `docs/epics/main/REVIEW-REPORT.md` for full findings. Key issues to track:

- SEC-001: shell injection risk via `ctx.branch` in `datum-closeout.ts`
- SEC-002: prompt injection via preamble interpolation in `datum-awake.ts`
- CORR-004: `datum-go` batch partitioning ignores DAG wave boundaries
- ARCH-001: Act batch loop should be extracted from `datum-go.ts` to `shared/utils.ts`

---

## [Epic 23] — 2026-05-29 (Mega Fix Session)

### Added
- **`sweep_project_memories` during closeout** (#20): Automatically flags active `project` memories in `~/.claude/projects/*/memory/` with the closing epic's branch and `updated` date.
- **AI-friendly Crash Hints**: Unhandled exceptions in `datum/cli.py`, `datum/gate.py`, and `datum/local_llm.py` now print a scrubbed traceback and explicitly instruct LLM agents to run `datum bugfile <module> "<message>" --trace "<traceback>"`.
- **Interactive bug filing**: For human users, an unhandled exception in the CLI now interactive asks `Would you like to auto-file this bug to GitHub? [y/N]` and auto-files it.
- **Traceback Sanitization**: Tracebacks are now cleanly sanitized via `_sanitize` before printing, stripping `Path.home()` and redacting any potential secrets.

### Changed
- **`project` Memory Expiration** (#20): Lowered `project` memory expiration window from 60 days to 28 days (2 sprints) in `datum/memory_audit.py` to prevent agents from relying on stale state.
- **Memory Frontmatter Schema** (#20): Formally added `created`, `updated`, `epic`, and `issues` to the memory frontmatter schema in `references/dream.md`. `datum/memory_audit.py` now parses these when validating staleness.

### Fixed
- **`max_tokens` conflation** (#42): Fixed the default config template which previously set `max_tokens` to `131072` (the full context window), causing the budget check to reject all prompts.
- **Legacy renderer refactor** (#23): Refactored the legacy render path in `datum/lane_plan.py` to reuse `_render_task_block` by adding a `heading_level` parameter.

## [Epics 19–22] — 2026-05-28

### Added
- **`datum walkthrough`** — generates `WALKTHROUGH.md` post-mortem artifact from SPEC, TASKS, git diff via `run_phase("sidecar_docs", schema=WalkthroughSummary)`. Deterministic fallback if LLM unavailable.
- **Two-tier model routing** — `fast_model` / `fast_phases` config: Llama-3.1-8B-Instruct-4bit for triage/validate (~120 t/s), Qwen3-30B-A3B-8bit for act/sidecar phases (~35 t/s). `get_model_for_phase()` routes automatically.
- **KV cache quantization** — `kv_bits=8` and `max_kv_size` config options propagate through both `stream_generate` and outlines `gen()` kwargs. ~50% KV memory reduction for Qwen3-30B.
- **`hf_cache_dir`** config option — datum sets `HF_HUB_CACHE` at load time so models on external drives work without shell env vars.
- **`TriageDecision` Pydantic schema** — `datum/models/triage_decision_schema.py` with `decision: Literal["deepen", "properties"]` and `reason: str`. Enables grammar-constrained triage via `run_phase("triage", schema=TriageDecision)`.
- **`prompt_cache` threading in `multi_turn_phase`** — cache created before turn loop, passed to structured/two_pass/vote calls. MLX accumulates KV state across turns.
- **`_cache_offset(cache)`** helper — reads `cache[0].offset` safely for MLX KVCache offset tracking.
- 24 new tests across 4 test files.

### Fixed
- **Budget check always rejected prompts** (#42) — `DEFAULTS["max_tokens"]` was 131072 (equal to `context_window`), making every `check_context_budget` return `fits=False`. Changed to 8192.
- **`datum walkthrough` wrong result key** — `result["content"]` → `result["text"]` (run_phase without schema returns `text` key, not `content`).
- **`git diff` returncode inverted** — returncode 1 = changes found (normal), 2 = error. Fixed condition to `returncode != 2`.
- **`check_questions_answered` false-flags multi-line answers** (#24) — now peeks ahead to next non-empty non-header line when `[Answer]:` has no inline text.
- **`_contracts()` opaque indexing** (#22) — all call sites now use named unpacking `validate_payload, validate_value = _contracts()`.
- Top-level import of `datum.walkthrough` in `cli.py` moved inside function body — prevents CLI startup crash if walkthrough deps fail.

### Stats
- 5 commits, 37 files, +2110 / -356 LOC, 94 tests passing

## [Epic 18] — 2026-05-28

### Added
- **Multi-turn local LLM orchestration**: plan→execute→synthesize loop with per-phase config overrides
  - Two-pass DCCD generation (arxiv 2603.03305): freeform draft then grammar-constrained extraction
  - Self-consistency voting (RASC, NAACL 2025): N-sample majority vote replaces self-reported confidence
  - Few-shot prompting (arxiv 2605.02363): example JSON injected into every prompt
  - Grammar-tight schemas: `StepResult.recommendation` is a Literal enum, all fields capped at 80 chars
  - Temperature scheduling: fixed, rising, falling, u_curve modes across turns
  - Parameterized quality gates: char flood, n-gram repetition, lexical diversity — all config-driven
- **Agent-Computer Interface (ACI)**: local model can execute tools autonomously
  - Read/write tool tiers with `enable_write_tools` gate (off by default)
  - Command injection blocking: `BLOCKED_COMMANDS` frozenset + shell operator detection
  - Path sandboxing: all string args checked against repo root, blocks escape attempts
  - `<untrusted>` XML tagging on tool output for prompt injection defense
  - Progressive disclosure: truncation with explicit `System Note` hinting
- **Lane tools**: `read_file.py`, `list_dir.py`, `grep_search.py`, `run_command.py`, `read_file_range.py`
  - All registered in `manifest.toml` with permissions and timeouts
- **CLI pipeline flags** (closes #44): `--system`, `--json`, `--max-tokens`, `--temperature`, `--strip-thinking`, `--multi-turn`, `--phase`, `--mt-turns`, `--mt-confidence`, `--mt-schedule`, `--mt-timeout`
- `datum init` now seeds AGENTS.md with full local LLM multi-turn documentation
- Multi-turn status display in `datum local-llm` (no args)

### Changed
- `datum/schemas.py`: added `StepPlan`, `StepResult`, `StepAction`, `ToolCall` schemas
- `datum/local_llm.py`: +903 lines — multi-turn engine, two-pass, voting, quality gates, ACI loop
- `datum/cli.py`: full pipeline flag suite + multi-turn interactive testing
- `assets/config.toml.default`: `[multi_turn]` section with 15 parameters + per-phase overrides + quality gates

### Fixed
- CLI crash: `Console.print(stderr=True)` replaced with `Console(stderr=True)` instance
- Multi-word prompts: `datum local-llm how many r in strawberry` works without quotes
- Shell autocompletion: `datum --install-completion` for bash, zsh, fish, powershell

### Stats
- 13 files changed, +1,554 / -16 lines
- Pair-programmed across 6 rounds between Claude (Opus 4.6) and Gemini (3.1 Pro)

## [Epic 17] — 2026-05-28

### Added
- **datum-tui**: Textual-based factory floor dashboard (`datum floor`)
  - Pipeline status panel: phase, run ID, branch, in-flight count, local LLM config
  - Lanes table: phase, status, model, retries per lane
  - Metrics panel: token cost, Gemma savings, escalation rate
  - Event log: live tail of `.datum/events.jsonl`
  - Command input: quick actions (`r` refresh, `q` quit, `s` status)
- **OpenRouter TUI reference**: Complete TypeScript reference implementation with screenshots
  - Agent loop, tool system, session management, CLI with slash commands
  - 9 screenshot demos across input styles, loaders, and tool displays
- `datum floor` CLI command to launch the TUI
- `datum-tui/test_app.py` with 4 smoke tests

### Changed
- `datum/cli.py`: added `floor` subcommand routing to `datum-tui/app.py`

### Stats
- 51 files changed, +5,345 / -3 lines

## [Epic 16] — 2026-05-28

### Added
- `datum init` now seeds hooks, config.toml, and lane-tools to every bootstrapped repo

## [Epic 15] — 2026-05-28

### Changed
- Local LLM enforcement: hook blocks shell invocation, AGENTS.md mandates Agent tool

## [Epic 14] — 2026-05-28

### Added
- Grammar-constrained generation via outlines + pydantic schemas for pipeline tasks

## [Epic 13] — 2026-05-28

### Added
- `datum --version` flag
### Fixed
- `seed_state_docs` no longer nukes existing CLAUDE.md

## [Epic 12] — 2026-05-28

### Fixed
- local-llm `chat()` import path
- SSOT `max_tokens` default resolution

## [Epic 11] — 2026-05-28

### Added
- Local LLM beta: MLX Gemma 4 26B inference with retry ladder escalation + cost tracking

## [Epic 10] — 2026-05-28

### Added
- Semantic memory extraction via MLX + Jina v5 on Apple Silicon

## [Epic 9] — 2026-05-28

### Added
- `datum dream`: first-class memory consolidation with staleness audit + transcript extraction

## [Epic 8] — 2026-05-28

### Changed
- All documentation uses `datum <command>` CLI syntax, zero `uv run` exposure

## [Epic 7] — 2026-05-27

### Added
- Rock-solid installer: prerequisite checks (git/uv/Python), `~/.local/bin/datum` wrapper, symlink registration

## [Epic 6] — 2026-05-27

### Added
- Mermaid diagram skill: 9 reference docs, 5 design templates, 3 render/validate/extract scripts

## [Epic 5] — 2026-05-27

### Added
- Self-healing: `datum bugfile` CLI + `report_bug()` with sanitized output

## [Epic 4] — 2026-05-27

### Added
- Express pipeline reference doc (`0x-express.md`) for Patch-tier routing

## [Epic 3] — 2026-05-27

### Fixed
- 6 ruff violations across artifact.py, contracts.py, prompt_loader.py

## [Epic 2] — 2026-05-27

### Fixed
- SSOT path resolution via `resolve_artifact()`
- Triage enforcement (can no longer skip)
- GitNexus-first Deepen phase
- Branch auto-increment

## [Epic 1] — 2026-05-27

### Added
- AIDLC-inspired pipeline: overconfidence gate, adaptive depth classifier, units of work
- `LANDSCAPE.md` filesystem scaffold generator
- `QUESTIONS.md` structured Q&A artifact
- 45 new tests
