# Phase: Act

**Goal:** Implement all tasks via pipelined three-agent TDD (RED → GREEN → REFACTOR), committing verified code to the work branch.

## Inputs

- `TASKS.md` — implementation plan
- `docs/PROPERTIES.md` — invariants each lane must prove
- `lane-plan.json` — the task DAG with dependency and conflict edges
- Language override doc (e.g., `references/04-act-swift.md`)
- `references/04-act-red-brief.md`, `references/04-act-green-brief.md`, `references/04-act-refactor-brief.md`
- `references/pipeline-dispatch.md`
- `scripts/lane-tools/README.md`

## Skeleton preflight (per-lane, before RED)

For each lane before RED dispatches:
```
datum skeleton --task-id <id> --language <detected_lang> --output .datum/runs/<RUN_ID>/preflight-<id>.json
```
Writes named test functions (one per AC) into the test files. RED fills assertion bodies; it
does not invent function names or file structure. If `no_skeletons_reason` is set, skip and
proceed to RED normally. See `references/04-act-skeleton-preflight.md` for full protocol.

## Pre-flight checks

Before starting any lane:
1. Confirm the work branch from state (`git.work_branch` — `datum/<slug>`, or legacy `datum/epic-<N>`) exists; if not, create from main
2. Confirm `scripts/test_signal.py` supports the detected test framework. If not, halt:
   "test_signal.py does not support framework X. Extend the parser or skip ACT for this repo."
3. Confirm no pending flakies above the configured threshold (default: 3). If exceeded: halt.
4. Start the commit queue process: `datum commit-queue --run-id <RUN_ID>`
5. Record docs/epics/$BRANCH/SPEC.md hash and start the drift detector sidecar:
   `datum spec-drift --run-id <RUN_ID> --interval 60 &`
   See `references/spec-drift.md` for how drift is classified and resolved.

At every stage boundary before dispatching new lanes, check for the drift flag:
`.datum/runs/<RUN_ID>/.spec-drift-detected` — if present, pause dispatch and surface to user.

## Concurrent Sidecars (Orchestration Port)

Alongside the main Red-Green-Refactor loop, the pipeline dispatches two continuous sidecars:
1. **security-sidecar (Threat Modeler):** Performs continuous STRIDE threat modeling, dependency risk analysis, and secrets scanning on all file changes committed by the REFACTOR agent.
2. **docs-scaffolder (Docs Scaffolder):** Automatically scaffolds and updates inline documentation, READMEs, and component interfaces concurrently as the REFACTOR agent commits code.

These sidecars run asynchronously and log their findings to `.datum/runs/<RUN_ID>/sidecars/`.

## Pipeline execution

Read `references/pipeline-dispatch.md` for the full scheduler logic. Summary:

1. Load lane-plan.json
2. Start eligible lanes (no unresolved dependencies, no file-ownership conflicts, under cap)
3. For each lane, run: RED → verify RED → GREEN → verify GREEN → REFACTOR → verify REFACTOR
4. As lanes complete stages and commit, unblock waiting lanes
5. Retry failed stages via `datum diagnose` before escalating
6. Cap at `in_flight_cap` concurrent agents (default: 7)

*Note on Task Complexity:* If `task_complexity` is `structural` (e.g., pure additive skeleton, deleting a file), the lane bypasses RED and GREEN stages completely. It goes straight to the REFACTOR stage to implement the structural change in a single pass. If `behavioral`, the full RED-GREEN-REFACTOR cycle runs.

## Three-Agent Contract

For `behavioral` tasks, each lane runs three agents in strict sequence. For `structural` tasks, only the REFACTOR agent runs. Read the brief specs for full context isolation rules:

**RED agent** (see `references/04-act-red-brief.md`):
- Sees: SPEC, PROPERTIES, task entry, GitNexus context, lane-tools README
- Does NOT see: implementation code for this task, other lanes' GREEN outputs
- Produces: stub commit (if task introduces new public types/methods) + failing test commit
- Done when: test runner returns RED, failure message references the property under test

**GREEN agent** (see `references/04-act-green-brief.md`):
- Sees: SPEC, PROPERTIES, task entry, GitNexus context, lane-tools README, redacted failure signal from `test_signal.py`
- Does NOT see: test source code, test names, RED agent brief or commit message
- Produces: minimum implementation to pass the test
- Done when: test runner returns GREEN

**REFACTOR agent** (see `references/04-act-refactor-brief.md`):
- Sees: everything — SPEC, PROPERTIES, implementation, test source, test results, GitNexus impact
- May NOT: relax or remove tests, add new tests (if missing AC found, fail back to RED)
- Produces: refined implementation, optional lane-tools additions, proof-of-work (see below)
- **Gemba Verdict:** Returns a concise report of the most difficult trade-off or decision made.
- **5S Shine Step:** Automatically cleans up temporary files, unused imports, and ensures standardization before marking the task done.
- Done when: all tests green, hooks pass, linter clean, formatter clean, AC checklist satisfied, 5S hygiene verified.

**ADVERSARIAL agent** (see `references/04-act-adversarial-brief.md`):
- Runs after REFACTOR commits, before lane is marked `completed`
- Sees: docs/PROPERTIES.md, public type signatures, ACs — NOT implementation, NOT tests
- Produces: `CandidateEdgeCases` JSON — property violations the test suite likely misses
- REFACTOR reviews each `gap` candidate; real gaps → new RED-GREEN cycle; others → dismissed
- If `no_gaps_found: true` → REFACTOR review skipped; lane marked `completed`

## Stage verification

After each stage, verify:
- RED: `datum test-signal` → status must be `fail` with property_id present
- GREEN: `datum test-signal` → status must be `pass`
- REFACTOR: `datum test-signal` → status must be `pass`; also run linter + formatter

## Commit flow

Each stage commit goes through the commit queue:
```
Lane signals commit-ready → commit_queue.py applies patch → pre-commit hooks run →
commit created on work branch → lane notified of new HEAD SHA
```

See `references/pipeline-dispatch.md` §Commit Queue for the patch format and serialization protocol.

<!-- inject: references/04-act-edge-cases.md -->

## Delivery Gate & Sync Point

Pipeline ends when all lanes are `completed` or `failed_terminal`.
**Delivery Gate:** A lane cannot be marked `completed` if the `security-sidecar` sidecar has logged `high_critical_count > 0` for that lane's changes. The pipeline MUST block and await remediation.

At sync point: collect diagnostic packets for any failed lanes.
Transition to Validate phase.

## Outputs

- Commits on the work branch: stub commits, RED commits, GREEN commits, REFACTOR commits
- `brief_defects` accumulated in state (missing ACs found by REFACTOR)
- `lane_tools_added` accumulated in state
