# datum — Agentic TDD Pipeline

datum takes a ticket and turns it into tested, reviewed, merged code — fully automated, with hard structural gates at every phase. It's not a coding assistant you chat with; it's a production line that enforces TDD, file ownership, and DAG-parallel execution by design.

## The Pipeline

```
Ticket/Issue
    |
    v
 REFINE -----> PLAN -----> ACT -----> VALIDATE -----> REVIEW -----> CLOSEOUT
 (clarify)    (decompose)  (TDD)      (full suite)    (code review)  (merge/tag)
```

### Refine

Interrogates the ticket for ambiguities. Produces `QUESTIONS.md`. Gates on human sign-off (unless running in `yolo` mode). Catches underspecified requirements before any code exists.

### Plan

Decomposes the spec into a **lane plan** — a DAG of independent work units with:
- File ownership (which files each lane can touch)
- Acceptance criteria (what "done" means, testably)
- Dependency edges (`depends_on` for ordering)

Produces `lane-plan.json` and `TASKS.md`. Human approval gate.

Before the lane plan is written, `datum-plan` runs a deterministic cycle guard (`assertAcyclicTasks`) over the decomposed tasks' `depends_on` edges and throws — refusing to write `tasks.json`/`lane-plan.json` — if any dependency cycle is found, naming the task ids involved. Decomposition also honors an optional `context_files` array in `.datum/config.json` (defaults to `[]`): each listed path is read from the repo root and injected into the decomposition prompt as authoritative project build-order/module-boundary documentation, taking precedence over any build order the model would otherwise infer from source imports. Missing `context_files` entries are logged as warnings and skipped rather than failing the phase.

```json
{
  "context_files": ["docs/ARCHITECTURE.md", "docs/module-boundaries.md"]
}
```

### Act — The TDD Engine

This is the core. Each lane runs the full **RED / GREEN / REFACTOR** cycle in an isolated git worktree:

1. **RED** — Write failing tests first. Skeleton functions with `NotImplementedError` bodies. The pipeline verifies tests actually fail before proceeding.
2. **GREEN** — Write the minimum implementation to make the tests pass. No more.
3. **REFACTOR** — Clean up with tests still green.

Lanes execute in **waves** based on topological sort of the DAG. Independent lanes within a wave run in parallel. A lane can only modify its declared files — cross-lane file access is a hard violation, not a warning.

### Validate

Runs the full test suite on the merged branch. If tests are red, the pipeline halts. No skipping, no overrides.

### Review

Automated code review. Critical findings block merge. Non-critical findings get filed as GitHub issues for follow-up.

### Closeout

Merges to target branch, closes GitHub issues, tags the run, generates docs.

## Key Concepts

| Concept | What it means |
|---|---|
| **Lane** | One task = one lane = one git worktree. Physical isolation, not just convention. |
| **DAG scheduling** | Lanes declare dependencies. Topo-sort produces waves. Parallelism within a wave, ordering between waves. |
| **Skeleton generation** | Before RED, datum pre-generates test scaffolding from acceptance criteria. One named test per AC — traceability is machine-verifiable. Supports flat, directory/package-style (e.g. Swift/JVM test packages), and docs-only test conventions via `test_convention` (#270). |
| **Gates** | Every phase has a pass/fail gate. Non-yolo runs halt and wait for human input. Pipeline state persists for resume. |
| **File ownership** | Each lane declares which files it touches. The pipeline enforces this — a lane physically cannot commit changes to files it doesn't own. |
| **Self-healing** | If the pipeline crashes unexpectedly, it auto-files a deduplicated GitHub issue before halting. |

## What Makes It Different

Most AI coding tools are conversational — you ask, it writes, you hope it's right. datum is structural:

- **TDD is mandatory, not suggested.** RED must fail before GREEN runs. Post-hoc tests are rejected.
- **Isolation is physical.** Each lane gets its own git worktree. No "please don't touch that file" — it can't.
- **Gates are blocking.** The pipeline cannot skip a failing phase. No "just push it and we'll fix later."
- **Parallelism is safe.** DAG scheduling + worktree isolation means lanes run concurrently without stepping on each other.
- **Resume is built in.** Pipeline state persists. Crash at any point, pick up where you left off with `datum go --start-from <phase>`.

## Running It

```bash
# Full pipeline from a GitHub issue
datum go --issue 42

# Resume from a specific phase
datum go --start-from act

# YOLO mode (skip human approval gates)
datum go --issue 42 --yolo
```

### Bootstrapping from an existing feature branch

`datum init` (and by extension `datum go`) can adopt an existing feature branch instead of
always cutting a new one. If you're already checked out on a non-default, non-protected
branch that has no `TICKET.md` yet, `datum init` bootstraps the epic in place on that branch
rather than creating a new `datum/<slug>` branch (#213). `datum init --json` reports this via
an `"adopted": true` field so calling scripts/workflows can detect it:

```bash
git checkout -b my-feature-branch
datum init --json   # {"epicBranch": "my-feature-branch", ..., "adopted": true}
```

## Architecture

- **CLI**: Python (Typer) — `datum <command>`
- **Workflows**: TypeScript, compiled to JS — orchestrate agents, manage worktrees, enforce gates
- **Local LLM**: Lightweight phases use a local model. If confidence is low, escalates to Claude with accumulated context as a head start. Config lives under a `[local_llm]` table in a TOML config file; a duplicate `[local_llm]` table (or any other duplicate key) fails fast with a clear "Duplicate [local_llm] table" error naming the offending config file, instead of a bare TOML parser traceback (#265).
- **State**: `.datum/` directory per repo — pipeline state, run artifacts, lane plans
