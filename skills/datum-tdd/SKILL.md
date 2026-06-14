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
- **estimated_impl_lines**: estimated lines of implementation code GREEN will write (split task if >30)
- **green_model**: optional model override for GREEN agent (e.g., "opus" for complex tasks)

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
      "depends_on": [],
      "estimated_impl_lines": 20,
      "green_model": null
    }
  }
}
```

The `topological_order` must respect `depends_on` — a task's dependencies must
appear before it in the list.

## Step 5: Build structured workflow args

Use `datum tdd-args` to generate the structured args object. This handles branch naming,
run ID generation, test command detection, and language detection automatically.

```bash
datum tdd-args --feature "<feature-description>" --lane-plan .datum/lane-plan.json
```

This outputs JSON with `epicBranch`, `runId`, `lanePlanPath`, `testCommand`, and `language`.

NEVER forward raw freetext to the workflow — always use `datum tdd-args` to build the args object.

## Step 6: Create epic branch

```bash
git branch <epicBranch-from-step-5> HEAD
```

## Step 7: Launch the workflow

Parse the JSON output from step 5 and pass it as args:

```
Workflow({
  name: "datum-tdd-act",
  args: <JSON-from-step-5>
})
```

## Step 8: Report

Tell the user:
- What tasks were created and their wave grouping
- The epic branch name
- That the workflow is running (use `/workflows` to watch)

## Important constraints

- Plans with >5 tasks are auto-partitioned into sequential batches of ≤5 by the workflow — no manual splitting needed
- NEVER let estimated_impl_lines exceed 30 for any task — split the task if the implementation would be larger
- For large features (>10 tasks), group tasks into logical units with clear dependency boundaries between groups
- NEVER guess file paths — verify they exist with `ls` or `find`
- NEVER put two tasks in the same wave if they write to the same file
- NEVER assign an EXISTING test file (one with passing tests) to a task — always create a NEW test file per feature so verify-red can detect failures cleanly
- The test command must work FROM A WORKTREE (the workflow creates git worktrees)
- ACs must be testable by calling actual code — no "should be well-structured" vibes
- red_note MUST say "Create a NEW file" for the test file and "NEVER use raise NotImplementedError"
