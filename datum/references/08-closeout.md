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
python3 scripts/closeout/collect_git.py --run-id <RUN_ID> --base-sha <BASE_SHA> --merge-sha <MERGE_SHA>
python3 scripts/closeout/collect_tasks.py --run-id <RUN_ID>
python3 scripts/closeout/collect_platform.py --run-id <RUN_ID>
python3 scripts/closeout/collect_lane_tools.py --run-id <RUN_ID>
python3 scripts/closeout/collect_brief_defects.py --run-id <RUN_ID>
python3 scripts/closeout/collect_wait_times.py --run-id <RUN_ID> # Value Stream Mapping
python3 scripts/closeout/collect_token_metrics.py --run-id <RUN_ID>
python3 scripts/closeout/collect_gitnexus_diff.py --run-id <RUN_ID> --base-sha <BASE_SHA> --merge-sha <MERGE_SHA>
python3 scripts/closeout/detect_solutions.py --run-id <RUN_ID> --base-sha <BASE_SHA> --merge-sha <MERGE_SHA>
```

Then: `python3 scripts/closeout/collate.py --run-id <RUN_ID> --merge-sha <MERGE_SHA> --epic-number <N>` produces `closeout-data.json`.

Validate against `assets/schemas/closeout-data.schema.json`.

### Stage 2 — Synthesis (LLM, Reasoning tier)

The synthesis agent reads `closeout-data.json` as its primary input. Every factual claim must be grounded in that file. No reading other source files for fresh data — the collated JSON is the data boundary.

Produce in order (each depends on previous):
1. `CURRENT_STATE.md` — full rewrite of project state post-epic
2. `ROADMAP.md` — epic moved to Completed; recalculate downstream dependencies
3. `CHANGELOG.md` — append entries for what shipped, with key numbers
4. `RETRO.md` — metrics, observations, brief-defects summary, lane-tools summary, token trend
5. `solutions/<slug>.md` — one per detected solved problem
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
python3 scripts/closeout/commit_closeout.py  # skips if closeout commit already exists
python3 scripts/closeout/tag_epic.py         # skips if tag exists; never overwrites
python3 scripts/closeout/file_followups.py   # dedup_key per entry; checks tracker first
python3 scripts/closeout/gitnexus_reindex.py # async, non-blocking
python3 scripts/closeout/archive.py          # copies state.json to runs dir, clears live state
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

## Ordering invariant

```
ACT done → Validate → Review → PR opened → PR Comments → fixes → PR merged → Closeout
```

Closeout NEVER runs against an unmerged PR. The tag is applied to the merge commit AFTER merge. Tag-then-merge is rejected.
