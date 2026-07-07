# PROPERTIES.md — Consumer-First Build-Order Analysis for datum-plan

Derived from `SPEC.md` (Consumer-First Build-Order Analysis for datum-plan). Each property is
independently testable and traces to one or more `TASKS.md` task IDs.

## Task ID legend

- `T1` = `add-context-files-config-default`
- `T2` = `add-upstream-source-context`
- `T3` = `wire-lane-upstream-injection`
- `T4` = `add-cycle-detection`
- `T5` = `datum-plan-buildorder-and-context`

---

## 1. SAFETY — what must NEVER happen

- PROPERTY(SAFETY-001): `datum-plan` must never write `lane-plan.json` (or hand off to `datum lane-plan`) when the decomposed task graph contains a dependency cycle — the cycle check must run and halt before the write/shellout. (R1/AC1.4)
- PROPERTY(SAFETY-002): `datum-tdd-act-lane` must never write a `TaskPacket` with a missing or empty `upstream_source[path]` entry for a path that is required (i.e., listed as an upstream implFile of a `depends_on` lane) — it must throw instead of silently omitting or blanking the entry. (R2/AC2.4)
- PROPERTY(SAFETY-003): `upstream_source` must never include contents of an upstream lane's `testFiles` — only `implFiles` per `classifyFiles`. (R2/AC2.3)
- PROPERTY(SAFETY-004): A `context_files` path that does not exist relative to the project root must never cause `datum-plan` to throw/abort the run — it must warn and continue. (R3/AC3.4)
- PROPERTY(SAFETY-005): `inject_read_dependency_edges` and `inject_conflict_edges` in `datum/lane_plan.py` must never be modified by this feature — behavior/byte-identity of that module is preserved. (R1/AC1.3, NFR)
- PROPERTY(SAFETY-006): `resolveUpstreamSource`/`buildPacket` changes must never alter the existing signature/behavior of `buildPacket` when called without an `upstream_source` argument (no regression for callers that don't pass it). (R2/AC2.1)

## 2. LIVENESS — what must EVENTUALLY happen

- PROPERTY(LIVENESS-001): For an acyclic decomposed task graph, `datum-plan` must eventually proceed to lane-plan generation (the cycle guard must not block valid graphs). (R1/AC1.4)
- PROPERTY(LIVENESS-002): For a SPEC with a consumer/producer file pair (e.g. `vdj-engine.js` consuming `vdj-state.js`), the decompose step must eventually emit `depends_on`/`reads` such that `lane:vdj-engine` depends on `lane:vdj-state` after `datum lane-plan` runs. (R1/AC1.2)
- PROPERTY(LIVENESS-003): Once an upstream `depends_on` lane has completed and its implFiles exist on disk, every subsequent stage (RED/GREEN/REFACTOR) packet build for the dependent lane must eventually include that content in `upstream_source`. (R2/AC2.2)
- PROPERTY(LIVENESS-004): When `context_files` entries exist and are readable, their content must eventually appear in the decompose prompt payload before the prompt is sent. (R3/AC3.2)

## 3. INVARIANT — what must ALWAYS be true

- PROPERTY(INVARIANT-001): `DEFAULT_CONFIG.context_files` is always `[]` when unset by a merged config, and always an array of strings when present. (R3/AC3.1)
- PROPERTY(INVARIANT-002): `DEFAULT_CONFIG`'s pre-existing keys (`language`, `test_framework`, `test_command`, `skills_dir`) are always present and unchanged in shape after adding `context_files`. (R3/AC3.1)
- PROPERTY(INVARIANT-003): `detectCycles(tasks)` always returns `[]` for any acyclic DAG, regardless of node count or ordering. (R1, T4)
- PROPERTY(INVARIANT-004): `detectCycles` is always pure — identical input always yields identical output, with no filesystem or I/O side effects. (T4)
- PROPERTY(INVARIANT-005): `TaskPacket.upstream_source`, when present, always maps file-path keys to full raw file-content strings (no truncation/summarization) for every transitively-`depends_on` implFile. (R2/AC2.1, AC2.2)
- PROPERTY(INVARIANT-006): `resolveUpstreamSource` always resolves the *transitive* closure of `depends_on` (A→B→C means A's packet includes C's implFiles too), not just direct dependencies. (T2)
- PROPERTY(INVARIANT-007): `context_files` project-declared content, when it conflicts with the LLM's own inferred import graph, always takes precedence per the decompose prompt instructions. (R3/AC3.3)

## 4. BOUNDARY — valid input ranges

- PROPERTY(BOUNDARY-001): `detectCycles([])` (empty task list) is a valid input and returns `[]`. (T4)
- PROPERTY(BOUNDARY-002): `detectCycles` correctly classifies the minimal 2-node mutual-dependency cycle (A↔B) as cyclic. (T4/AC per graph.test.ts)
- PROPERTY(BOUNDARY-003): `detectCycles` correctly classifies a 3-node transitive cycle (A→B→C→A) as cyclic, and does not falsely flag a 3-node linear chain (A→B→C, no return edge) as cyclic. (T4)
- PROPERTY(BOUNDARY-004): `context_files: []` (empty array, the explicit default) produces identical decompose-prompt output to `context_files` being entirely absent from config. (R3/AC3.5)
- PROPERTY(BOUNDARY-005): A lane with `depends_on` absent/`undefined`/`[]` yields `upstream_source` that is absent or an empty object — never a non-empty object. (R2/AC2.2, AC2.5)
- PROPERTY(BOUNDARY-006): `resolveUpstreamSource` handles a `depends_on` chain of at least depth 2 (transitive) without special-casing depth 1 only. (INVARIANT-006, T2)

## 5. IDEMPOTENT — what is safe to run twice

- PROPERTY(IDEMPOTENT-001): Running `detectCycles` twice on the same task list produces identical results both times (no hidden mutation of input `tasks`). (T4)
- PROPERTY(IDEMPOTENT-002): Calling `resolveUpstreamSource` twice for the same lane/worktree state returns byte-identical `upstream_source` maps (pure read, no caching side effects that could return stale data on second call after files change... conversely, an unchanged worktree yields unchanged output). (T2)
- PROPERTY(IDEMPOTENT-003): Re-running `datum-plan`'s config-read step twice against the same `.datum/config.json` yields the same resolved `context_files` list and the same injected prompt content each time. (T5)
- PROPERTY(IDEMPOTENT-004): Building the RED packet twice for the same lane state (no new files written in between) yields an identical `upstream_source` payload both times. (T3)

## 6. ORDERING — order invariants

- PROPERTY(ORDERING-001): Cycle detection (`detectCycles`) must run strictly *before* `lane-plan.json` is written / `datum lane-plan` is shelled out to. (R1/AC1.4, T5)
- PROPERTY(ORDERING-002): `context_files` must be read and injected into the decompose prompt *before* the decompose LLM call is made (not after, not post-hoc appended). (R3/AC3.2)
- PROPERTY(ORDERING-003): `resolveUpstreamSource` for a downstream lane must only be invoked *after* its `depends_on` lane(s) have completed in the DAG schedule (per existing `datum-tdd-act.ts`/`datum-go.ts` ordering) — packet build for a lane must not race ahead of its dependencies. (R2/AC2.4, Failure Modes table)
- PROPERTY(ORDERING-004): Within `plan-decompose.md`'s emitted checks, the BUILD-ORDER / IMPORT ANALYSIS CHECK's inferred `depends_on` must be finalized before the existing `inject_read_dependency_edges`/`inject_conflict_edges` Python step consumes `reads`/`depends_on` (R1/AC1.3 — inputs must be stable before consumption).
- PROPERTY(ORDERING-005): `buildPacket` must include `upstream_source` in the same packet-construction pass as `target_context`/`extras` for each of RED/GREEN/REFACTOR stages, not injected asynchronously after the packet is written to disk. (R2/AC2.1, T2/T3)

## 7. ISOLATION — what cannot leak between contexts

- PROPERTY(ISOLATION-001): `upstream_source` for lane X must never include files belonging to lanes not in X's transitive `depends_on` set (no cross-lane leakage of unrelated sibling-lane files). (R2/AC2.1)
- PROPERTY(ISOLATION-002): `upstream_source` must never include a downstream lane's own in-progress/uncommitted files — only already-completed upstream dependency files. (R2, Failure Modes)
- PROPERTY(ISOLATION-003): One `datum-tdd-act-lane.test.ts` fixture's temp worktree/lane definitions must not interfere with another test's fixtures (dedicated describe block per task's RED Note). (T3)
- PROPERTY(ISOLATION-004): `context_files` content injected for one `datum-plan` run must not persist into or contaminate the decompose prompt of a subsequent unrelated run/repo with different config. (R3)
- PROPERTY(ISOLATION-005): Test files (`testFiles`) of upstream lanes must be isolated from (excluded from) `upstream_source`, preventing test-only code from leaking into a downstream lane's context. (R2/AC2.3)

## 8. PERFORMANCE — latency/throughput/size bounds

- PROPERTY(PERFORMANCE-001): `upstream_source` growth is bounded to `implFiles` only (excludes `testFiles`), preventing unbounded doubling of injected content per dependency. (R2/AC2.3, Failure Modes)
- PROPERTY(PERFORMANCE-002): `detectCycles` completes in time proportional to nodes+edges (standard graph traversal), not exponential blowup, for task graphs of realistic size (tens of files). (T4, implicit from "deterministic" requirement)
- PROPERTY(PERFORMANCE-003): No token/size budget is enforced in this iteration for cumulative `upstream_source` across deep dependency chains — this is an explicitly accepted, unbounded-but-flagged behavior (Open Question Q4); the test suite should not assert a hard byte cap since none is specified. (Non-Functional / Out of Scope note — documented gap, not a passing/failing property today)

## 9. SECURITY — access controls

- PROPERTY(SECURITY-001): `context_files` paths must be resolved and read only relative to the project root — `datum-plan` must not read arbitrary absolute paths or escape the project root via traversal (`../../etc/passwd`-style) without at least the same guard as other project-root-relative config paths (e.g. `skills_dir`). (R3/AC3.2, Assumption #3)
- PROPERTY(SECURITY-002): `resolveUpstreamSource` must only read files that are legitimate outputs of `depends_on` lanes within the shared worktree — it must not be usable to read arbitrary out-of-worktree paths supplied via lane metadata. (R2/AC2.2)

## 10. OBSERVABILITY — what must be logged or measured

- PROPERTY(OBSERVABILITY-001): A cycle detected pre-lane-plan-write must produce an explicit, user-visible error message naming the specific cyclic task/file IDs (not a generic failure). (R1/AC1.4)
- PROPERTY(OBSERVABILITY-002): A missing `context_files` path must produce a logged warning identifying the specific missing path. (R3/AC3.4)
- PROPERTY(OBSERVABILITY-003): A missing upstream dependency file at packet-build time must produce an error message that names both the missing file path and the owning lane. (R2/AC2.4, TASKS.md `add-upstream-source-context`)

## 11. COMPATIBILITY — existing behavior that must be preserved

- PROPERTY(COMPATIBILITY-001): For repos/config with `context_files` absent or `[]` (including this repo's own `.datum/config.json` today), the decompose prompt payload is byte-identical to pre-feature output — no new section rendered. (R3/AC3.5)
- PROPERTY(COMPATIBILITY-002): `inject_read_dependency_edges` and `inject_conflict_edges` in `datum/lane_plan.py` require zero code changes, and their existing `tests/test_units.py` cases continue to pass unmodified. (R1/AC1.3)
- PROPERTY(COMPATIBILITY-003): The `Lane` interface's existing optional `reads?`/`depends_on?` fields and their consumers (`datum-tdd-act.ts:138`, `datum-go.ts:322`, `datum-tdd-act-lane.ts` `allDeps`) require no structural changes. (R1, Assumption #6)
- PROPERTY(COMPATIBILITY-004): `READ_CONFIG_PROMPT` requires no changes — it continues to merge config generically without enumerating `context_files` explicitly. (R3, Assumption #8)
- PROPERTY(COMPATIBILITY-005): `buildPacket` calls that omit the new `upstream_source` argument produce packets identical in shape to today's (existing `target_context`/`extras` behavior unaffected). (R2/AC2.1)
- PROPERTY(COMPATIBILITY-006): `skills/datum-plan.js` and `skills/datum-tdd-act-lane.js` are only ever updated via `bash scripts/build-workflows.sh` regeneration from `.ts`/`.md` source — never hand-edited. (NFR, Build pipeline compliance)

---

## Traceability Table

| Property ID | Category | Predicate (short) | Task IDs |
|---|---|---|---|
| SAFETY-001 | Safety | No lane-plan write on cyclic graph | T4, T5 |
| SAFETY-002 | Safety | No packet with missing required upstream entry | T2, T3 |
| SAFETY-003 | Safety | testFiles never in upstream_source | T2 |
| SAFETY-004 | Safety | Missing context_files path never aborts run | T5 |
| SAFETY-005 | Safety | lane_plan.py edge-injection funcs unchanged | T1–T5 (regression guard, no dedicated task) |
| SAFETY-006 | Safety | buildPacket unaffected when arg omitted | T2 |
| LIVENESS-001 | Liveness | Acyclic graph proceeds to lane-plan | T4, T5 |
| LIVENESS-002 | Liveness | Consumer/producer pair yields correct depends_on | T5 (decompose prompt) |
| LIVENESS-003 | Liveness | Completed upstream content eventually injected each stage | T2, T3 |
| LIVENESS-004 | Liveness | context_files content eventually reaches prompt | T5 |
| INVARIANT-001 | Invariant | context_files always [] or string[] | T1 |
| INVARIANT-002 | Invariant | Existing DEFAULT_CONFIG keys unchanged | T1 |
| INVARIANT-003 | Invariant | detectCycles([]/acyclic) always [] | T4 |
| INVARIANT-004 | Invariant | detectCycles pure, deterministic | T4 |
| INVARIANT-005 | Invariant | upstream_source values are full raw content | T2 |
| INVARIANT-006 | Invariant | Transitive closure of depends_on resolved | T2 |
| INVARIANT-007 | Invariant | context_files precedence over inferred graph | T5 |
| BOUNDARY-001 | Boundary | detectCycles([]) valid | T4 |
| BOUNDARY-002 | Boundary | 2-node mutual cycle detected | T4 |
| BOUNDARY-003 | Boundary | 3-node transitive cycle vs linear chain | T4 |
| BOUNDARY-004 | Boundary | context_files:[] == absent | T5 |
| BOUNDARY-005 | Boundary | No depends_on → empty/absent upstream_source | T2, T3 |
| BOUNDARY-006 | Boundary | Depth-2+ transitive chain handled | T2 |
| IDEMPOTENT-001 | Idempotent | detectCycles same input twice, no mutation | T4 |
| IDEMPOTENT-002 | Idempotent | resolveUpstreamSource stable across calls | T2 |
| IDEMPOTENT-003 | Idempotent | Config read twice → same context_files result | T5 |
| IDEMPOTENT-004 | Idempotent | Rebuilding RED packet twice → identical payload | T3 |
| ORDERING-001 | Ordering | Cycle check before lane-plan write | T4, T5 |
| ORDERING-002 | Ordering | context_files read before decompose call | T5 |
| ORDERING-003 | Ordering | Upstream resolved only after dep lane completes | T3 |
| ORDERING-004 | Ordering | depends_on finalized before Python edge-injection consumes it | T5 |
| ORDERING-005 | Ordering | upstream_source built in same pass as target_context/extras | T2, T3 |
| ISOLATION-001 | Isolation | No cross-lane leakage outside depends_on set | T2 |
| ISOLATION-002 | Isolation | No in-progress downstream files leak into upstream_source | T2, T3 |
| ISOLATION-003 | Isolation | Test fixtures isolated per describe block | T3 |
| ISOLATION-004 | Isolation | context_files content scoped per run | T5 |
| ISOLATION-005 | Isolation | Upstream testFiles excluded | T2 |
| PERFORMANCE-001 | Performance | upstream_source bounded to implFiles only | T2 |
| PERFORMANCE-002 | Performance | detectCycles scales with nodes+edges | T4 |
| PERFORMANCE-003 | Performance | No hard budget enforced (documented gap) | T5 (documentation only) |
| SECURITY-001 | Security | context_files resolved relative to project root, no traversal | T5 |
| SECURITY-002 | Security | resolveUpstreamSource confined to worktree/dep lanes | T2 |
| OBSERVABILITY-001 | Observability | Cycle error names cyclic ids | T5 |
| OBSERVABILITY-002 | Observability | Missing context_files path logs warning w/ path | T5 |
| OBSERVABILITY-003 | Observability | Missing upstream file error names file+lane | T2 |
| COMPATIBILITY-001 | Compatibility | Byte-identical prompt when context_files absent/[] | T5 |
| COMPATIBILITY-002 | Compatibility | lane_plan.py edge-injection tests pass unmodified | T5 (verification only) |
| COMPATIBILITY-003 | Compatibility | Lane interface / consumers unchanged | T2, T3, T5 |
| COMPATIBILITY-004 | Compatibility | READ_CONFIG_PROMPT unchanged | T1, T5 |
| COMPATIBILITY-005 | Compatibility | buildPacket shape unchanged when arg omitted | T2 |
| COMPATIBILITY-006 | Compatibility | .js files only regenerated via build script, never hand-edited | T1–T5 |

---

## Per-Task Property Assignments

### T1 — `add-context-files-config-default`
- INVARIANT-001, INVARIANT-002
- BOUNDARY-004 (partially exercised here; fully proven with T5)
- COMPATIBILITY-004

### T2 — `add-upstream-source-context`
- SAFETY-002, SAFETY-003, SAFETY-006
- LIVENESS-003 (helper-level correctness)
- INVARIANT-005, INVARIANT-006
- BOUNDARY-005, BOUNDARY-006
- IDEMPOTENT-002
- ORDERING-005 (buildPacket wiring half)
- ISOLATION-001, ISOLATION-002, ISOLATION-005
- PERFORMANCE-001
- SECURITY-002
- OBSERVABILITY-003
- COMPATIBILITY-003, COMPATIBILITY-005

### T3 — `wire-lane-upstream-injection`
- SAFETY-002
- LIVENESS-003
- BOUNDARY-005
- IDEMPOTENT-004
- ORDERING-003, ORDERING-005
- ISOLATION-002, ISOLATION-003
- COMPATIBILITY-003

### T4 — `add-cycle-detection`
- SAFETY-001 (guard building block)
- LIVENESS-001 (building block)
- INVARIANT-003, INVARIANT-004
- BOUNDARY-001, BOUNDARY-002, BOUNDARY-003
- IDEMPOTENT-001
- ORDERING-001 (building block; full wiring in T5)
- PERFORMANCE-002

### T5 — `datum-plan-buildorder-and-context`
- SAFETY-001, SAFETY-004
- LIVENESS-001, LIVENESS-002, LIVENESS-004
- INVARIANT-007
- BOUNDARY-004
- IDEMPOTENT-003
- ORDERING-001, ORDERING-002, ORDERING-004
- ISOLATION-004
- PERFORMANCE-003 (documented, not a hard-pass test)
- SECURITY-001
- OBSERVABILITY-001, OBSERVABILITY-002
- COMPATIBILITY-001, COMPATIBILITY-002, COMPATIBILITY-003, COMPATIBILITY-004

### Cross-cutting (no single owning task; verified by regression/full-suite run)
- SAFETY-005 — verified by running existing `tests/test_units.py` unchanged (per AC1.3), not a new task
- COMPATIBILITY-006 — process/build-pipeline property, enforced by code review and `scripts/build-workflows.sh` discipline across T1–T5

**Task coverage check**: All 5 tasks (T1–T5) have at least one assigned property. No task is without a testable property.
