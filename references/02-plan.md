# Phase: Plan

**Goal:** Decompose docs/epics/$BRANCH/SPEC.md into a topologically-sorted, machine-readable TASKS.md where every task has a clear scope, acceptance criteria, file set, and RED note.

## Inputs

- `docs/epics/<branch>/SPEC.md` — refined requirements (resolve branch: `git rev-parse --abbrev-ref HEAD`)
- `docs/research/<branch>-findings.md` or `docs/adr/` — **Must be promoted from 01.5-research.md if uncertainty was high.**
- GitNexus `impact` on each proposed change site (if available)
- `CURRENT_STATE.md` (if present)

## Steps

### 0. Read prior failure memory

Before decomposing tasks, read two sources of prior-epic intelligence:

**Brief defects** (`brief_defects` arrays in prior runs' `closeout-data.json`):
```
jq -r '.brief_defects[]? | "\(.surfaced_by_stage)\t\(.missing_ac)"' .datum/runs/*/closeout-data.json 2>/dev/null || echo "(no prior closeout data)"
```
If recurring AC gaps appear (e.g., "timeout handling" or "error logging" chronically missing), write more explicit RED notes for tasks in those categories this epic.

**ERRORS.md** (cross-session failure log):
```
cat .datum/ERRORS.md 2>/dev/null || echo "(no error history yet)"
```
Scan for entries touching files or modules relevant to this SPEC. If a prior REASONING or UNKNOWN failure targeted the same files, note the failed approach in the task decomposition so agents don't repeat it.

Both sources are the single most actionable inputs for improving Plan quality.
If this is the first epic in this repo, skip this step.

### 0.5. Surface architectural approaches before decomposing

**Do not decompose tasks yet.** First, present 2-3 distinct architectural approaches to the human and wait for a choice.

For each approach include:
- One-sentence description of the strategy
- Key tradeoffs (speed vs. safety, complexity vs. flexibility, etc.)
- Which existing modules it touches most
- Estimated task count and blast radius

Example format:
```
Approach A — [name]: [1-sentence description]
  Tradeoffs: [what you gain / what you give up]
  Blast radius: [modules affected]
  Rough scope: ~N tasks

Approach B — [name]: ...

Approach C — [name]: ...

Which approach should I decompose?
```

Only proceed to step 1 after the human has chosen. If the human says "you choose" or "whatever's best", pick the simplest approach and state your choice explicitly before decomposing.

After presenting approaches, append any implementation-level questions to `docs/epics/<branch>/QUESTIONS.md` with a `## Plan — YYYY-MM-DD` header. Use the same format as Refine questions (numbered, category-tagged, with context blocks and `[Answer]:` tags). Commit and wait for answers before decomposing.

### 1. Impact analysis

For each module or symbol that will change:
- If GitNexus available: run `gitnexus impact <symbol>` to understand blast radius; use results to group tasks by blast radius (low-impact tasks can share lanes; high-impact tasks get isolated lanes)
- If degraded: use heuristic file-count and LOC delta; log `risk_unknown` annotation

### 2. Decompose into tasks

Each task maps to one lane. A lane owns a cohesive set of files. Split tasks so:
- No task touches more than 5 files (guideline; exception allowed with justification)
- Tasks that share files go in the same lane or are sequenced with a dependency edge
- Tasks that introduce new public types/methods note this in the `introduces_stubs` field (RED will emit stub commits for these)

Task shape (see `assets/schemas/task.schema.json`):
```json
{
  "id": "task-001",
  "title": "...",
  "description": "...",
  "acceptance_criteria": ["...", "..."],
  "files": ["Sources/...", "Tests/..."],
  "depends_on": [],
  "introduces_stubs": true,
  "red_note": "What the failing test should prove; which docs/PROPERTIES.md property it covers",
  "estimated_loc": 100
}
```

### 2.5. Unit decomposition (System-tier only)

**Skip this step for Patch and Feature tiers.** Only System-tier epics (as classified by `datum classify`) require unit decomposition.

Group tasks into parallelizable units of work:
1. Identify independent work clusters — sets of tasks that share no files and have no behavioral dependencies
2. Assign each cluster a unit ID: `unit-<name>` (e.g., `unit-auth`, `unit-api`)
3. Map every task to exactly one unit via the `unit` field in tasks.json
4. Define inter-unit dependencies in the top-level `units` key:

```json
{
  "tasks": [...],
  "units": {
    "unit-auth": { "name": "Auth Middleware", "tasks": ["task-001", "task-002"], "depends_on": [] },
    "unit-api": { "name": "API Endpoints", "tasks": ["task-003"], "depends_on": ["unit-auth"] }
  }
}
```

**Rules:**
- Every task must belong to exactly one unit
- The unit dependency graph must be acyclic (validated by `lane_plan.py`)
- Tasks within a unit can run in parallel; a unit doesn't start until its dependency units complete
- Units that share no dependencies can be assigned to different developers

### 3. Topological sort

Order tasks so dependencies come first. Tasks with no dependencies can run in parallel.
**Goal:** Decompose docs/epics/$BRANCH/SPEC.md into a topologically-sorted, machine-readable `tasks.json` (validating against `assets/schemas/tasks.schema.json`) where every task has a clear scope, acceptance criteria, file set, and RED note. `TASKS.md` is then automatically generated from this JSON.
...
### 4. Write tasks.json

Output the decomposed tasks as a JSON array in `tasks.json`. Ensure every field from `assets/schemas/task.schema.json` is present.

### 5. Build lane-plan.json and TASKS.md

Run `datum lane-plan --input tasks.json --output .datum/lane-plan.json`

This script validates the JSON, performs the topological sort, and produces:
- `TASKS.md` — rendered human-readable version of the plan (root, for DATUM execution engine)
- `lane-plan.json` — DAG for the pipeline scheduler

After generation, copy TASKS.md into the epic directory so it is preserved permanently:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
cp TASKS.md "docs/epics/$BRANCH/TASKS.md"
cp tasks.json "docs/epics/$BRANCH/tasks.json"
```

`TASKS.md` in the root is the live execution copy — it will be overwritten by the next epic. `docs/epics/<branch>/TASKS.md` is the permanent record.

### 6. Gate

Before running the gate, the agent MUST complete the `## Assumption Audit` section in docs/epics/<branch>/SPEC.md:
- List at least 3 assumptions baked into the SPEC
- For each: state the assumption, justify it, and mark Status as `confirmed` or `guess`
- For `guess` entries: add `Resolves: Q<N>` pointing to an answered question in QUESTIONS.md
- If the Refine phase generated zero questions, note this — the gate will emit a warning

Run `datum gate plan`

Validates:
1. Every task has `acceptance_criteria`, `files`, `red_note`
2. DAG is acyclic and all dependency IDs resolve
3. No task is missing a `depends_on` entry when its `files` overlap with another task
4. If `plan_human_approval = required`: gate exits 1 with `needs_human: true` and instructs the human to re-run with `--approve` after reviewing

After human review: `datum gate plan --approve`

On pass: update state.
On fail: surface the validation errors and rework.

`--approve` bypasses the `needs_human` hold; `--yolo` is a pipeline-level flag that skips optional gates but does NOT bypass `plan_human_approval = required`.

## Outputs

| File | Location | Purpose |
|------|----------|---------|
| `tasks.json` | repo root + `docs/epics/<branch>/` | Structured task list |
| `TASKS.md` | repo root (execution) + `docs/epics/<branch>/` (archive) | Rendered implementation plan |
| `lane-plan.json` | `.datum/` | DAG for pipeline scheduler |
| `docs/epics/<branch>/QUESTIONS.md` | `docs/epics/<branch>/` | Plan-section questions appended |


## Failure modes

- TASKS.md not topo-sorted → `datum lane-plan --validate` exits 1; skill rewrites
- TASKS.md missing RED note per task → gate exits 1; skill rewrites
- Circular dependency detected → halt, surface the cycle, ask user how to resolve
