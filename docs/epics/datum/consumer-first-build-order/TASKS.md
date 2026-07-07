# Implementation Plan (TASKS.md)

## Dependency Graph
```mermaid
graph TD
  add-upstream-source-context --> wire-lane-upstream-injection
  add-cycle-detection --> datum-plan-buildorder-and-context
  add-context-files-config-default --> datum-plan-buildorder-and-context
```

## add-context-files-config-default: Add context_files default to DEFAULT_CONFIG
Add an optional context_files: string[] key (default []) to DEFAULT_CONFIG in shared/models.ts so datum-plan can later read project-declared build-constraint docs. READ_CONFIG_PROMPT merges config generically and needs no change.

- **Acceptance Criteria**:
  - DEFAULT_CONFIG.context_files deep-equals [] (empty array) by default
  - DEFAULT_CONFIG still exposes existing keys language, test_framework, test_command, skills_dir unchanged
  - A config object merged over DEFAULT_CONFIG that omits context_files resolves context_files to [] (default applied, not undefined)
- **Files**: skills/src/shared/models.ts, skills/src/shared/models.test.ts
- **RED Note**: This is a TypeScript/vitest project (.test.ts files built via scripts/build-workflows.sh), NOT pytest. Write skills/src/shared/models.test.ts importing DEFAULT_CONFIG from './models' and assert expect(DEFAULT_CONFIG.context_files).toEqual([]) plus that the existing keys are still present. The test must fail today because context_files does not exist on DEFAULT_CONFIG.
- **Estimated LOC**: 25

## add-upstream-source-context: Add TaskPacket.upstream_source, resolveUpstreamSource helper, and buildPacket wiring
Add optional upstream_source?: Record<string,string> to the TaskPacket interface in shared/types.ts; add a deterministic resolveUpstreamSource(lane, allLanes, worktreeDir) helper in shared/utils.ts that enumerates a lane's transitive depends_on, classifies implFiles vs testFiles via the existing classifyFiles convention, reads each upstream implFile from the worktree, and throws a structured Error naming the missing file+lane if any dependency implFile is absent on disk; and extend buildPacket to accept an optional upstream_source argument and emit it into the returned packet object. testFiles of upstream lanes are excluded.

- **Acceptance Criteria**:
  - TaskPacket interface declares optional upstream_source?: Record<string, string> (type-checks under tsc)
  - resolveUpstreamSource(lane, allLanes, worktreeDir) returns a Record mapping each transitive-depends_on implFile path to its full file contents read from worktreeDir
  - resolveUpstreamSource excludes testFiles of upstream lanes (only implFiles per classifyFiles are included)
  - resolveUpstreamSource throws an Error whose message names the missing file path and owning lane when a required upstream implFile does not exist on disk
  - buildPacket, when passed an upstream_source map, includes it verbatim under packet.upstream_source; when not passed, packet.upstream_source is absent or empty
- **Files**: skills/src/shared/types.ts, skills/src/shared/utils.ts, skills/src/shared/utils.test.ts
- **RED Note**: TypeScript/vitest, not pytest. In skills/src/shared/utils.test.ts create a temp worktree dir (os.tmpdir/mkdtemp), write a fixture upstream impl file (e.g. vdj-state.js) and a fixture test file, define two Lane objects where the downstream lane has depends_on referencing the upstream lane, then assert resolveUpstreamSource returns { 'vdj-state.js': '<contents>' } and does NOT include the upstream test file. Add a case where the upstream impl file is not written and assert resolveUpstreamSource throws with the missing path in the message. Add a buildPacket case asserting the returned packet carries upstream_source when supplied. utils.ts is high blast-radius (14 importers) — keep changes additive; do not alter existing buildPacket parameters' behavior.
- **Estimated LOC**: 70

## wire-lane-upstream-injection: Inject upstream_source into RED/GREEN/REFACTOR packets in datum-tdd-act-lane
In datum-tdd-act-lane.ts, have runLane compute upstream source via resolveUpstreamSource for the lane's depends_on chain and pass it into buildPacket at each of the RED/GREEN/REFACTOR stages, so every stage's TaskPacket carries the full source of already-built upstream implFiles. Missing-file failures from resolveUpstreamSource must propagate (fail fast) rather than be swallowed.

- **Acceptance Criteria**:
  - For a lane with depends_on:['lane:vdj-state'] whose upstream produced vdj-state.js on disk, the written RED-stage TaskPacket JSON contains the full contents of vdj-state.js under upstream_source['vdj-state.js']
  - For a lane with no depends_on, the written TaskPacket has upstream_source empty or absent (no injected upstream content)
  - When a depends_on lane's implFile is missing from the worktree at packet-build time, runLane surfaces the resolveUpstreamSource Error (fail fast) instead of writing a packet with empty upstream content
- **Files**: skills/src/datum-tdd-act-lane.ts, skills/src/datum-tdd-act-lane.test.ts
- **Depends on**: add-upstream-source-context
- **RED Note**: TypeScript/vitest, not pytest. In skills/src/datum-tdd-act-lane.test.ts set up a fixture worktree with an upstream impl file present and two lanes (dependent + upstream), invoke the packet-building path for the dependent lane, and assert the emitted TaskPacket JSON includes upstream_source with the upstream file contents. Add a negative case: a lane with no depends_on yields no/empty upstream_source. Add a missing-file case asserting the build path throws. datum-tdd-act-lane.ts is the largest file in scope (761 LOC) with existing coverage in datum-tdd-act-lane.test.ts — keep this lane's new assertions in a dedicated describe block and do not reuse other lanes' test files.
- **Estimated LOC**: 55

## add-cycle-detection: Add deterministic import-graph cycle detection module
Create skills/src/shared/graph.ts exporting a pure detectCycles(tasks) function that, given task nodes with { id, depends_on }, returns the set(s) of ids participating in any directed cycle (direct A->B->A or transitive A->B->C->A) and an empty array for an acyclic DAG. This is the deterministic guard datum-plan will invoke post-decompose, pre lane-plan shellout, honoring the chosen coded cycle-guard approach.

- **Acceptance Criteria**:
  - detectCycles([]) and detectCycles for any acyclic DAG returns [] (no cycles)
  - detectCycles detects a direct cycle: tasks A(depends_on:[B]) and B(depends_on:[A]) returns a cycle containing both A and B
  - detectCycles detects a transitive cycle: A->B->C->A returns a cycle containing A, B, and C
  - detectCycles is pure (no I/O, no filesystem, deterministic for identical input)
- **Files**: skills/src/shared/graph.ts, skills/src/shared/graph.test.ts
- **RED Note**: TypeScript/vitest, not pytest. In skills/src/shared/graph.test.ts import detectCycles from './graph' and assert: empty input -> []; a linear DAG -> []; two-node mutual depends_on -> a returned cycle set containing both ids; a three-node transitive loop -> a set containing all three ids. Tests must fail because graph.ts does not exist yet. Assertions must check actual cycle membership (deleting the function body must fail the test), not just truthiness.
- **Estimated LOC**: 50

## datum-plan-buildorder-and-context: Wire cycle guard, context_files injection, and build-order prompt into datum-plan
Integrate the plan-time changes into skills/src/datum-plan.ts and its decompose prompt. (1) After decompose and before writing lane-plan.json, call detectCycles on the emitted tasks; if any cycle is found, halt with an explicit Error naming the cyclic task/file set rather than emitting a cyclic depends_on graph (AC1.4, fail-fast). (2) In the config-read step, read context_files from the merged config, resolve each path relative to the project root, read its contents into the decompose prompt payload, and on a missing path log a warning and continue without failing the run. (3) Edit prompts/plan-decompose.md to add a named BUILD-ORDER / IMPORT ANALYSIS CHECK instructing the decomposer to infer likely import direction across every file pair and populate depends_on/reads accordingly, plus a PROJECT BUILD CONSTRAINTS section that surfaces context_files content and states it takes precedence over the LLM's own inferred import graph. When context_files is absent or [], no new prompt section content is rendered and behavior is unchanged.

- **Acceptance Criteria**:
  - When the decomposed tasks contain a dependency cycle, datum-plan throws/halts with an explicit Error naming the cyclic task ids/files before lane-plan.json is written (never emits a cyclic depends_on graph)
  - When tasks are acyclic, datum-plan proceeds to lane-plan generation unchanged
  - datum-plan reads context_files from the merged config and injects each existing file's full contents (resolved relative to project root) into the decompose prompt payload
  - A context_files entry whose path does not exist relative to project root produces a logged warning and is skipped; the plan run continues (no throw)
  - When context_files is absent or [], no context-files prompt section content is injected and the decompose prompt payload is byte-identical to today's (backward compatible)
  - prompts/plan-decompose.md contains a section titled with 'BUILD-ORDER' / 'IMPORT ANALYSIS CHECK' and a 'PROJECT BUILD CONSTRAINTS' section that references context_files and states project docs take precedence over inferred imports
- **Files**: skills/src/datum-plan.ts, skills/src/prompts/plan-decompose.md, skills/src/datum-plan.test.ts
- **Depends on**: add-cycle-detection, add-context-files-config-default
- **RED Note**: TypeScript/vitest, not pytest. skills/src/datum-plan.test.ts does NOT exist today (confirmed coverage gap) — create it. Cover: (a) feeding cyclic tasks through the plan step throws an Error naming the cyclic ids before lane-plan.json is written; (b) acyclic tasks do not throw; (c) with a config listing an existing context_files path, the built decompose prompt payload string includes that file's contents and the 'PROJECT BUILD CONSTRAINTS' text; (d) a non-existent context_files path warns and is skipped without throwing; (e) with context_files absent/[], the rendered prompt contains no injected constraints section; (f) assert the plan-decompose.md template string includes 'BUILD-ORDER' and 'PROJECT BUILD CONSTRAINTS'. datum-plan.ts is imported by datum-go.ts and datum-properties.ts — keep changes additive. Note: skills/datum-plan.js is generated via scripts/build-workflows.sh; edit only the .ts and .md source.
- **Estimated LOC**: 110
