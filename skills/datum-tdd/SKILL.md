---
name: datum-tdd
description: "Launch the datum TDD pipeline on a feature. Takes a feature description or GitHub issue, decomposes it into tasks with acceptance criteria, generates lane-plan.json, creates the epic branch, and fires the workflow. Use this skill whenever the user wants to implement a feature using TDD, says 'datum tdd', 'run tdd on', 'implement this with tests', or references a GitHub issue they want to build with the datum pipeline."
---

# datum-tdd: Feature → TDD Pipeline

This skill bridges the gap between "I want to build X" and the deterministic
`datum-tdd-act` workflow. It handles everything the workflow needs as input.

## When to use

- User says "datum tdd", "tdd this", "implement with tdd"
- User references a GitHub issue and wants it built
- User describes a feature and wants tests-first implementation
- User says "run the pipeline on this"

## Input

One of:
- A feature description in natural language
- A GitHub issue number (e.g., `#42`)
- A file path to a spec or task list

## What this skill produces

1. **Lane plan** (`.datum/lane-plan.json`) — tasks, ACs, file ownership, dependencies
2. **Epic branch** (`git branch <name> HEAD`)
3. **Workflow launch** — fires `datum-tdd-act` with the correct args

## Step 1: Gather the feature spec

If the user gave an issue number, fetch it:
```bash
unset GITHUB_TOKEN && gh issue view <number> --json title,body,labels
```

If the user gave a description, use it directly. If it's vague, ask ONE
clarifying question — don't interview. Bias toward action.

## Step 2: Decompose into tasks

Break the feature into 2-5 tasks. Each task needs:

- **id**: `task-001`, `task-002`, etc.
- **title**: what this task implements (one sentence)
- **files**: which source and test files this task touches
- **acceptance_criteria**: 2-4 specific, testable ACs starting with "AC1:", "AC2:", etc.
- **red_note**: hint for the RED agent on what tests to write
- **stage**: `behavioral` (needs RED→GREEN) or `structural` (refactor only)
- **depends_on**: list of task IDs this depends on (for wave ordering)

Guidelines for good decomposition:
- Each task should be independently testable
- File ownership should be clear — avoid two tasks writing to the same file in the same wave
- Dependencies create waves — independent tasks run in parallel, dependent tasks sequence
- ACs must be specific enough that a test can verify them (values, not vibes)
- red_note should tell RED what methods/classes to call that don't exist yet

## Step 3: Detect target files

Use the codebase to figure out which files each task touches:
- Grep for the module/class being extended
- Check if test files already exist or need creation
- Verify paths are correct (don't invent files)

## Step 4: Generate lane-plan.json

Write `.datum/lane-plan.json` with this structure:

```json
{
  "schema_version": "1.0",
  "total_lanes": <number of tasks>,
  "topological_order": ["task-001", "task-002", ...],
  "file_ownership": {
    "src/module.py": "task-001",
    "tests/test_module.py": "task-001"
  },
  "lanes": {
    "task-001": {
      "id": "task-001",
      "title": "...",
      "files": ["src/module.py", "tests/test_module.py"],
      "acceptance_criteria": ["AC1: ...", "AC2: ..."],
      "red_note": "...",
      "stage": "behavioral",
      "depends_on": []
    }
  }
}
```

The `topological_order` must respect `depends_on` — a task's dependencies must
appear before it in the list.

## Step 5: Create epic branch and run ID

```bash
git branch <epic-branch-name> HEAD
```

Branch naming: `feat/<short-kebab-description>` or `fix/<short-kebab-description>`.
Run ID: date-based, e.g., `20260613-feat-serialization`.

## Step 6: Detect test command

Look at the project to determine the right test command:
- Python with pytest: `uv run pytest tests/<test_file>.py -x -q`
- Python with unittest: `uv run python -m unittest tests/<test_file>.py`
- Check `pyproject.toml` for test configuration

## Step 7: Launch the workflow

```
Workflow({
  scriptPath: "<repo>/skills/datum-tdd-act.js",
  args: {
    lanePlanPath: ".datum/lane-plan.json",
    epicBranch: "<branch-name>",
    runId: "<run-id>",
    testCommand: "<detected test command>",
    language: "<python|typescript|swift|etc>"
  }
})
```

## Step 8: Report

Tell the user:
- What tasks were created and their wave grouping
- The epic branch name
- That the workflow is running (use `/workflows` to watch)

## Important constraints

- NEVER create more than 5 tasks — split into multiple pipeline runs if needed
- NEVER guess file paths — verify they exist with `ls` or `find`
- NEVER put two tasks in the same wave if they write to the same file
- NEVER assign an EXISTING test file (one with passing tests) to a task — always create a NEW test file per feature so verify-red can detect failures cleanly
- The test command must work FROM A WORKTREE (the workflow creates git worktrees)
- ACs must be testable by calling actual code — no "should be well-structured" vibes
- red_note MUST say "Create a NEW file" for the test file and "NEVER use raise NotImplementedError"
