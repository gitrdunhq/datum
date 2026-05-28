# Phase: Closeout

**Goal:** After the PR merges, produce the full set of post-epic artifacts: updated project docs, retro, solutions, follow-ups, git tag, and GitNexus reindex.

## Trigger

Runs automatically after merge. Requires the merge commit SHA as input.

Can also be invoked explicitly:
- `datum closeout` — run for the most recent epic
- `datum closeout <run_id>` — specific past RUN_ID
- `datum closeout --resume <run_id>` — resume an interrupted closeout (idempotent)
- `datum closeout --synth-only <run_id>` — re-run synthesis from existing closeout-data.json

## Architecture: Three Stages

### Stage 1 — Data Collection (scripts only, no LLM)

Each script runs independently and writes a `.collect-<name>.done` marker on completion.
`datum closeout --resume` skips collectors whose marker exists.

Run in parallel:
```bash
datum closeout-collect-git --run-id <RUN_ID> --base-sha <BASE_SHA> --merge-sha <MERGE_SHA>
datum closeout-collect-tasks --run-id <RUN_ID>
datum closeout-collect-platform --run-id <RUN_ID>
datum closeout-collect-lane-tools --run-id <RUN_ID>
datum closeout-collect-brief-defects --run-id <RUN_ID>
datum closeout-collect-wait-times --run-id <RUN_ID> # Value Stream Mapping
datum closeout-collect-token-metrics --run-id <RUN_ID>
datum closeout-collect-gitnexus-diff --run-id <RUN_ID> --base-sha <BASE_SHA> --merge-sha <MERGE_SHA>
datum closeout-detect-solutions --run-id <RUN_ID> --base-sha <BASE_SHA> --merge-sha <MERGE_SHA>
```

Then: `datum closeout-collate --run-id <RUN_ID> --merge-sha <MERGE_SHA> --epic-number <N>` produces `closeout-data.json`.

Validate against `assets/schemas/closeout-data.schema.json`.

### Stage 2 — Synthesis (LLM, Reasoning tier)

The synthesis agent reads `closeout-data.json` as its primary input. Every factual claim must be grounded in that file. No reading other source files for fresh data — the collated JSON is the data boundary.

Produce in order (each depends on previous):
1. `CURRENT_STATE.md` — full rewrite of project state post-epic (See `datum/references/current-state.md`)
2. `ROADMAP.md` — epic moved to Completed; recalculate downstream dependencies
3. `CHANGELOG.md` — append entries for what shipped, with key numbers
4. `RETRO.md` — metrics, observations, brief-defects summary, lane-tools summary, token trend
5. `Memory Consolidation` — run `datum dream` for the full pass: staleness audit, transcript extraction, episodic detection, memory write/update, index pruning. See `references/dream.md`.
6. `follow-ups.json` — gaps as machine-readable entries for issue tracker

**Resumption:** If synthesis fails partway through, completed artifacts are preserved. On `--resume`:
1. Read `closeout-data.json` as primary input
2. Read already-written artifacts as context only (do not regenerate)
3. Resume at the first unwritten artifact
4. Brief explicitly states: "Artifacts 1-N already exist. Read as context. Begin at artifact N+1."

If the user manually edited an artifact between crash and resume: treat the on-disk version as authoritative.

### Stage 3 — Side Effects (scripts only, after synthesis verified)

Each step writes its own success marker:

```bash
datum closeout-commit       # skips if closeout commit already exists
datum closeout-tag          # skips if tag exists; never overwrites
datum closeout-followups    # dedup_key per entry; checks tracker first
datum closeout-reindex      # async, non-blocking
datum closeout-archive      # copies state.json to runs dir, clears live state
```

## Failure isolation

- A failed Closeout does NOT block the next epic
- State is updated to `closeout_pending` for this RUN_ID
- Next `datum go` is permitted to start a new epic
- Pending closeouts accumulate; visible in `datum status`
- `datum closeout --resume <run_id>` clears them

## Token metrics capture

`collect_token_metrics.py` produces `token-metrics.json`:
- Total tokens for the epic (input + output)
- Per-phase breakdown
- Per-model overall token consumption
- Phase-by-model split (which models handled which phases, and their token ROI)
- Per-stage breakdown within ACT
- Per-lane breakdown
- Comparison to prior epic: total delta, per-LOC delta
- Lane-tools ROI: used vs. added this epic

## Closeout-specific findings (surfaced in RETRO, not failures)

- Solved problem with no test coverage → high-severity follow-up
- Brief defects above threshold → Plan quality regression follow-up
- Token cost per LOC up vs. prior epic → efficiency observation
- GitNexus blast radius bigger than predicted → informs next Plan phase
- say:do ratio below threshold → abandoned tasks observation
- Lane-tool added without description → config gate bug follow-up

## Merge Mechanics (Merge Queue)

DATUM relies on Pull Requests for integration.
- **Push to Remote:** After the Review phase passes, the Orchestrator pushes the branch to remote and creates a PR.
- **Rebase and Merge ONLY:** The PR MUST be integrated using **Rebase and Merge**. Squash merges are strictly forbidden because they destroy the atomic Conventional Commits generated by the AI agents.
- **Merge Queues:** For high-volume agent setups, a Sequential Merge Queue is strongly recommended to serialize integrations and prevent conflicts.

## Ordering invariant

```
ACT done → Validate → Review → PR opened → PR Comments → fixes → PR merged → Closeout
```

Closeout NEVER runs against an unmerged PR. The tag is applied to the merge commit AFTER merge. Tag-then-merge is rejected.
