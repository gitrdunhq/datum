# SPEC: Consumer-First Build-Order Analysis for datum-plan

## 1. Summary

`datum-plan` currently infers lane `depends_on` relationships purely from the SPEC narrative, which lets independent-looking lanes run in parallel even when one file will actually import another — causing `datum-tdd-act-lane` agents to write against interfaces that don't exist yet. This spec adds an explicit, LLM-driven build-order analysis sub-step to `datum-plan` that infers a consumer/producer file relationship graph and feeds it into the existing `depends_on` edge-injection machinery, and extends `datum-tdd-act-lane` to inject the full source of upstream (already-built) dependency files into each lane's task packet so agents stop hallucinating interface shapes.

## 2. Context

`datum-plan` (source: `skills/src/datum-plan.ts`, compiled to `skills/datum-plan.js` — never edit the `.js` directly) runs Read → Decompose (approach/impact/decompose, prompted by `skills/src/prompts/plan-decompose.md`) → writes `docs/epics/{branch}/tasks.json` → shells out to `datum lane-plan --input tasks.json --output lane-plan.json --md-output TASKS.md` (Python CLI backed by `datum/lane_plan.py`) → skeleton batch → Triage/Deepen → Gate → publish. There is currently no step between decompose and lane-plan generation that reasons about the actual file-level import graph of the files being built.

`plan-decompose.md` already instructs the decomposer to emit `depends_on` and `reads` per task and documents the existing consumer-first convention at the prompt level ("If a task reads a file another lane writes, it must either list that file in `reads` ... or add explicit `depends_on`"). The same file already carries several narrative "check before finalizing" rules (PROTOCOL COMPLETENESS CHECK, UNIFICATION/FORK-CONSUMPTION PARITY CHECK, BASELINE SYNC CHECK) — this spec follows that established pattern by adding a new BUILD-ORDER / IMPORT ANALYSIS CHECK rather than introducing a new workflow phase, consistent with how #308/#270/#310 solved similar plan-time gaps.

Downstream, `datum/lane_plan.py::inject_read_dependency_edges` (lines 144-163) already turns a task's `reads` list into `depends_on` edges via file-ownership lookup, mirroring the sibling `inject_conflict_edges` (line 126) for write/write conflicts. This is the existing mechanical edge-injection this spec's LLM-inferred import graph should feed, by having the decomposer populate `reads`/`depends_on` in `tasks.json` directly — no new Python function is required for requirement 1.

The `Lane` interface (`skills/src/shared/types.ts:72-87`) already has optional `reads?: string[]` and `depends_on?: string[]` fields consumed by `datum-tdd-act.ts:138`, `datum-go.ts:322`, and `datum-tdd-act-lane.ts:892` (`allDeps`) for DAG scheduling — no type changes are needed for requirement 1 or 2, only how the fields get populated and consumed.

`TaskPacket` (`skills/src/shared/types.ts:184-198`) has a `target_context?: Record<string, string[]>` field, currently populated from a narrower RED-agent preflight step (`datum-tdd-act-lane.ts:331-334`) and written to the worktree via `laneCtxCmd` (`skills/src/shared/utils.ts:559`). This is symbol-name context, not full file source, and does not satisfy requirement 2. `buildPacket` (`skills/src/shared/utils.ts:710-~750`), called once per stage (RED/GREEN/REFACTOR) in `datum-tdd-act-lane.ts`, is the natural injection point for a new full-source upstream-context field.

`DEFAULT_CONFIG` (`skills/src/shared/models.ts:56-61`) has no `context_files` key today; `.datum/config.json` in this repo likewise has none. `READ_CONFIG_PROMPT` (`skills/src/shared/models.ts:63-67`) merges config generically without enumerating keys, so adding `context_files` there requires no prompt change — only `datum-plan.ts`'s config-read step and `plan-decompose.md`'s prompt template need to reference the new key explicitly.

No existing AST/import-graph analyzer exists anywhere in `skills/src` or `datum/` — confirming the ticket's "Not This" framing that this must be LLM-driven from the SPEC's own file list and descriptions, not a mechanical multi-language differ.

## 3. Requirements

### R1 — Build-order analysis sub-step in `datum-plan`

After SPEC.md is read and before `tasks.json`/`lane-plan.json` are finalized, the decompose step must analyze the proposed file list from the SPEC and infer, for each pair of files (A, B), whether B is likely to import/require A, then encode consumer-first ordering into each task's `reads` and/or `depends_on` fields.

**Acceptance criteria:**
- AC1.1: `skills/src/prompts/plan-decompose.md` contains a new named check (e.g. "BUILD-ORDER / IMPORT ANALYSIS CHECK") instructing the decomposer to, for every pair of files across tasks, infer likely import direction from file names/descriptions/SPEC content and add `depends_on` (or `reads`) accordingly, consistent with the existing `reads` field documentation at line 33.
- AC1.2: Given a SPEC whose file list includes a state module (e.g. `vdj-state.js`) and a module described as consuming it (e.g. `vdj-engine.js`), the emitted `tasks.json` places the consuming task's `depends_on` (or `reads`, before Python edge-injection) such that after `datum lane-plan` runs, the resulting `lane-plan.json` has `lane:vdj-engine` depend on `lane:vdj-state`.
- AC1.3: The existing `datum/lane_plan.py::inject_read_dependency_edges` and `inject_conflict_edges` functions require no code changes — the new analysis populates `reads`/`depends_on` inputs consumed by that already-tested mechanism (verified by running existing `tests/test_units.py` cases for these functions unchanged).
- AC1.4: If the inferred import graph contains a cycle (A imports B, B imports A, whether directly or transitively), `datum-plan` must not silently emit a cyclic `depends_on` graph; it must flag the cycle and either resolve it by merging the files into one lane or halt with an explicit error surfaced to the user before `lane-plan.json` is written (see Failure Modes).
- AC1.5: A `datum-plan.test.ts` (or equivalent) test file exists exercising the new sub-step's prompt/logic with at least one two-file consumer/producer fixture and one no-dependency fixture, asserting the correct `depends_on`/`reads` output shape.

### R2 — Context injection for `datum-tdd-act-lane`

Each lane's act-lane agent (RED, GREEN, REFACTOR stages) must receive the full source of every file already produced by lanes in its `depends_on` chain, in addition to the lane spec and SPEC.md it already receives.

**Acceptance criteria:**
- AC2.1: `buildPacket` (`skills/src/shared/utils.ts`) accepts (or `runLane` in `skills/src/datum-tdd-act-lane.ts` computes and passes) a new field, e.g. `upstream_source: Record<string, string>`, mapping each dependency file path to its full file contents, distinct from and additive to the existing `target_context` mechanism.
- AC2.2: For a lane with `depends_on: ["lane:vdj-state"]` where `lane:vdj-state` has already completed and produced `vdj-state.js`, the RED-stage `TaskPacket` written for the dependent lane includes the full contents of `vdj-state.js` under `upstream_source["vdj-state.js"]`.
- AC2.3: Only `implFiles` (per the existing `classifyFiles` convention in `skills/src/shared/utils.ts`) of upstream dependency lanes are injected as source — test files (`testFiles`) of upstream lanes are excluded from `upstream_source`.
- AC2.4: If a `depends_on` lane has not yet completed (file doesn't exist on disk in the worktree) when the packet is built, `datum-tdd-act-lane` must fail fast with a clear error rather than injecting an empty/missing entry — this should not be reachable in normal DAG-respecting scheduling but must be guarded defensively.
- AC2.5: A test in `datum-tdd-act-lane.test.ts` verifies that `buildPacket`'s output JSON contains `upstream_source` populated from a fixture dependency lane's files, and that it is empty/absent when a lane has no `depends_on`.

### R3 — `context_files` config support

`.datum/config.json` supports an optional `context_files: string[]` array. When present, `datum-plan` reads the listed files (resolved relative to the project root) and injects their full contents into the decompose prompt so project-declared build-constraint docs (e.g. `BUILD-ORDER.md`, `ARCHITECTURE.md`) are always respected during build-order inference.

**Acceptance criteria:**
- AC3.1: `DEFAULT_CONFIG` in `skills/src/shared/models.ts` gains a `context_files: []` default entry alongside `language`/`test_framework`/`test_command`/`skills_dir`.
- AC3.2: `datum-plan.ts`'s config-read step reads `context_files` from the merged config (in addition to the currently-read `language`/`test_framework`) and, for each listed path, reads the file relative to the project root and includes its contents in the decompose prompt payload.
- AC3.3: `plan-decompose.md` references `context_files` content explicitly (e.g. under a "PROJECT BUILD CONSTRAINTS" section) so the decomposer is instructed to honor project-specific ordering rules found there, which take precedence over its own inferred import graph when the two conflict.
- AC3.4: If a path listed in `context_files` does not exist relative to the project root, `datum-plan` logs a warning and continues without that file's content rather than failing the whole plan run.
- AC3.5: When `context_files` is absent or `[]` (the default/current behavior for repos with no such key, including this repo's own `.datum/config.json` at time of writing), `datum-plan` behavior is unchanged from today — no injected content, no new prompt section rendered (or an empty/no-op section).

## 4. Failure Modes

| Failure Mode | Handling |
|---|---|
| Inferred import graph contains a cycle (A→B→A) | `datum-plan` detects the cycle before writing `lane-plan.json`; either merges the cyclic files into a single lane automatically, or halts with an explicit error naming the cyclic file set and asks the user/Gate step to resolve (per AC1.4). Never silently emit a cyclic `depends_on`. |
| `context_files` entry path doesn't exist | Warn and skip that file; do not fail the plan run (AC3.4). |
| Upstream dependency lane hasn't completed when a downstream lane's packet is built | Fail fast with a clear error identifying the missing file/lane rather than injecting empty content (AC2.4) — should not occur if `depends_on` scheduling in `datum-tdd-act.ts`/`datum-go.ts` is respected, but guarded defensively. |
| Cumulative `upstream_source` context grows very large across a long dependency chain | Not fully solved by this spec (see Open Questions); at minimum, only `implFiles` are injected (not tests), bounding growth to actual interface/source files. |
| LLM under- or over-infers import relationships from SPEC descriptions alone (no real source to check against at plan time) | Accepted risk per ticket's "Not This" — analysis is LLM-driven from SPEC file list/descriptions, not AST parsing. Mitigated by keeping the existing `reads`/`depends_on` manual override fields available in `tasks.json` for human/Gate correction. |
| `context_files` project-declared rule conflicts with the LLM's own inferred import graph | `context_files` content takes precedence per AC3.3 — the decomposer must defer to explicit project docs over its own inference. |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Backward compatibility | Existing SPECs/repos with no `context_files` key and no build-order-relevant SPEC content produce identical `lane-plan.json` output to today (AC3.5). |
| No new Python dependency-injection function required | `inject_read_dependency_edges`/`inject_conflict_edges` in `datum/lane_plan.py` remain unchanged (AC1.3). |
| Test coverage | New TS logic (`datum-plan.test.ts` additions, `datum-tdd-act-lane.test.ts` additions) covers at least one positive (dependency correctly inferred/injected) and one negative (no dependency, no injection) case per requirement. |
| Build pipeline compliance | All changes to workflow behavior are made in `skills/src/*.ts` and `skills/src/prompts/*.md`; `skills/datum-plan.js` and `skills/datum-tdd-act-lane.js` are regenerated via `bash scripts/build-workflows.sh`, never hand-edited. |
| Fail-fast over silent fallback | Missing upstream file, cyclic dependency, and missing `context_files` path all surface explicit errors/warnings rather than silently degrading (per project's no-silent-fallback convention). |

## 6. Out of Scope

- A full static-analysis/AST import-graph engine across every language datum might target. Analysis is LLM-driven, reading the SPEC's own proposed file list and descriptions — not a mechanical multi-language differ.
- Changing how lanes are dispatched or parallelized at Act time beyond respecting the (now more accurate) `depends_on` graph that already exists in `datum-tdd-act.ts`/`datum-go.ts`. This is a plan-time fix, not a new Act-phase scheduler.
- Parsing actual file source during the plan phase to verify inferred imports (no real files exist yet at plan time for most lanes).
- Solving unbounded context growth for arbitrarily long dependency chains (flagged as an open question, not designed away in this spec).
- Automatic capture of "output files from completed lanes" as a new general-purpose datum-tdd-act mechanism — this spec assumes existing worktree file state after a lane completes is sufficient for `datum-tdd-act-lane` to read files directly (see Assumption Audit, #2).

## 7. Open Questions

- Q1 (Behavior): Does build-order inference at plan time ever need to read real file stubs/source (if any exist, e.g. in an incremental/re-plan scenario), or is SPEC-description-only inference sufficient in all cases?
- Q2 (Integration): Is reading upstream files directly from the shared worktree filesystem (post-lane-completion) sufficient for requirement 2, or does `datum-tdd-act`/`datum-go` need an explicit "lane completed, here are its output file paths" signal that `datum-tdd-act-lane` should consume instead of scanning the worktree itself?
- Q3 (Integration): How should `context_files` paths be resolved — relative to the project root, the `.datum/config.json` directory, or the current working directory when `datum-plan` runs?
- Q4 (NFR): Is there a token/size budget for cumulative `upstream_source` injection when a lane has multiple/deep `depends_on` chains, and if so what should happen when it's exceeded (truncate, summarize, error)?
- Q5 (Behavior): When a cycle is detected in the inferred import graph, should `datum-plan` auto-merge the cyclic files into one lane, or always halt and require human/Gate intervention?

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | SPEC file descriptions contain enough detail for an LLM to infer likely imports, without parsing actual source files during the plan phase | Ticket's "Not This" section explicitly directs this approach, consistent with #308/#270/#310 precedent | decided | Q1 |
| 2 | `datum-tdd-act-lane` can read upstream dependency files directly from the shared worktree filesystem once a lane completes, without a new "output capture" signal from `datum-tdd-act`/`datum-go` | No existing capture mechanism was found in the scan; worktree files should already be present and readable post-completion given existing DAG scheduling order | guess | Q2 |
| 3 | `context_files` paths are resolved relative to the project root (matching how other datum config paths like `skills_dir` behave) | No existing `context_files` reader to confirm against; project-root resolution is the most common convention in this codebase's config handling | guess | Q3 |
| 4 | No explicit token/size budget is enforced for `upstream_source` injection in this iteration; only `implFiles` (not tests) are injected to bound growth naturally | Ticket doesn't mention a budget; scoping to implFiles is a reasonable minimal mitigation consistent with `classifyFiles` convention | decided | Q4 |
| 5 | Circular dependencies detected in the inferred import graph should halt the plan with an explicit error by default, rather than silently auto-merging | Matches project's "no silent fallback" / fail-fast convention (DPS-204); auto-merge could be added as a follow-up if desired | decided | Q5 |
| 6 | The `Lane` interface (`reads?`, `depends_on?`) and `inject_read_dependency_edges`/`inject_conflict_edges` in `datum/lane_plan.py` require no structural changes — only new inputs need to populate the existing fields | Confirmed via codebase scan (types.ts:72-87, lane_plan.py:126-163) | confirmed | n/a |
| 7 | `buildPacket` in `skills/src/shared/utils.ts` is the correct single injection point for new per-stage upstream source context, parallel to how `target_context`/`extras` are already handled | Confirmed via scan: buildPacket called 3x (RED/GREEN/REFACTOR) in datum-tdd-act-lane.ts, already handles `extras` | confirmed | n/a |
| 8 | `READ_CONFIG_PROMPT` needs no changes for `context_files` support since it merges config generically without enumerating keys | Confirmed via scan (models.ts:63-67) — only `datum-plan.ts`'s downstream usage and `plan-decompose.md` need explicit reference | confirmed | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 6
estimated_loc: 220
clusters_touched:
  - datum-plan-workflow
  - datum-tdd-act-lane-workflow
  - shared-config-schema
  - lane-plan-python-cli (read-only reference, no changes expected)
new_public_api:
  - "TaskPacket.upstream_source?: Record<string, string> (skills/src/shared/types.ts)"
  - "DEFAULT_CONFIG.context_files?: string[] (skills/src/shared/models.ts)"
dependency_additions: []
```
