# TICKET: AIDLC-Inspired Pipeline Enhancements

## Summary

Incorporate 5 structural improvements from AWS AIDLC into the DATUM pipeline, focused on humility (overconfidence prevention), proportionality (adaptive depth), parallelism (units of work), onboarding (landscape artifact), and async decision-making (file-based questions).

## Motivation

DATUM treats every epic the same regardless of complexity, doesn't check whether agents validated their assumptions before proceeding, has no concept of parallel units of work for multi-dev teams, doesn't generate onboarding artifacts for brownfield codebases, and loses clarifying Q&A in chat transcripts that disappear between sessions.

With a 3-developer team working across cities, these gaps become load-bearing.

## Requirements

### 1. Overconfidence Gate (Plan → Act boundary)

Before DATUM advances from Plan to Act, the agent must produce an **assumption audit**:
- List the 3 biggest assumptions baked into the SPEC
- For each: justify why it's safe, or flag it as a guess
- If any are guesses, they become mandatory questions before the gate opens
- Additionally: if Refine asked zero clarifying questions, flag this as a red signal

**Artifact:** Appended to SPEC.md as a `## Assumption Audit` section.

**Gate behavior:** `plan_human_approval` gate (already `required`) checks for the audit section. If missing or if unresolved guesses exist, gate fails.

### 2. Adaptive Depth Classifier (Dispatcher)

Auto-classify epic complexity at dispatch time. Three tiers:

| Tier | Criteria | Pipeline shape |
|------|----------|---------------|
| **Patch** | < 50 changed lines, single file cluster, no new public API | Express pipeline (existing) |
| **Feature** | Standard scope | Full pipeline as-is |
| **System** | Cross-cutting, new subsystem, multi-package, > 5 file clusters touched | Extended Plan with units of work, all properties mandatory, extended review |

Classification runs after Discovery/Refine produces the SPEC. Inputs: file count estimate, cluster spread (via GitNexus if available), public API surface change, dependency additions.

User can override the classification at the `plan_human_approval` gate.

### 3. Units of Work in Plan Phase

For **System-tier** epics, Plan produces unit groupings:

- Each task in `tasks.json` gets a `unit` field (string identifier)
- `tasks.json` gains a top-level `units` key:
  ```json
  {
    "units": {
      "unit-auth": { "name": "Auth Middleware", "tasks": ["task-001", "task-002"], "depends_on": [] },
      "unit-api": { "name": "API Endpoints", "tasks": ["task-003"], "depends_on": ["unit-auth"] }
    }
  }
  ```
- Act scheduler respects unit-level dependencies: all tasks in a unit can run in parallel, but a unit doesn't start until its dependency units are complete
- TASKS.md renders units as sections with dependency annotations

For Patch and Feature tiers, units are not generated (all tasks are implicitly one unit).

### 4. LANDSCAPE.md Artifact (Discovery)

During Discovery, generate `docs/LANDSCAPE.md`:

- Architecture clusters (from GitNexus `clusters` resource)
- Entry points and hot paths (from GitNexus `processes` resource)
- Tech stack (language, frameworks, package manager, test framework)
- Key abstractions and their relationships
- File tree summary with LOC per directory

Cache the artifact. Regenerate only when GitNexus index SHA changes from the last generation.

In degraded mode (no GitNexus): generate a lighter version using `find`, file extensions, and import scanning.

### 5. QUESTIONS.md with [Answer]: Tags (Refine + Plan)

Replace conversational Q&A with a committed artifact:

- **Location:** `docs/epics/<branch>/QUESTIONS.md`
- **Format:**
  ```markdown
  ## Refine — 2026-05-27

  ### Q1: [Category] Question text?
  > Context for why this matters.

  [Answer]:

  ### Q2: [Category] Another question?
  > Context.

  [Answer]:

  ## Plan — 2026-05-27

  ### Q3: [Implementation] Design question?
  > Context.

  [Answer]:
  ```
- Agent generates questions, commits the file, halts for answers
- User fills in `[Answer]:` lines (in editor or chat — agent updates the file)
- Follow-up questions append to the same file with a new date header
- File is committed after each Q&A round

## Out of Scope

- Changing the state machine or phase ordering (except adding the assumption audit check to the existing plan gate)
- AIDLC's stateless approach, single-model execution, or unstructured artifacts
- Product pipeline changes (triage/discovery/requirements/handoff)

## Acceptance Criteria

1. `datum doctor` passes with all new reference docs and schemas in place
2. Overconfidence gate rejects a SPEC with unresolved assumption guesses
3. Dispatcher auto-classifies a known-small change as Patch and routes to Express
4. System-tier Plan produces units in tasks.json with valid dependency graph
5. LANDSCAPE.md renders from GitNexus data (or degraded fallback)
6. QUESTIONS.md is generated during Refine, appended during Plan, and committed as an artifact
7. All existing tests pass (no regressions)
8. SKILL.md updated with new gate matrix, dispatcher logic, and artifact descriptions
