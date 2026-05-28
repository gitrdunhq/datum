# Phase: Properties

**Goal:** Derive a docs/PROPERTIES.md that covers all 11 property categories for every requirement in docs/epics/$BRANCH/SPEC.md, with traceability to specific tasks in TASKS.md.

## Inputs

- `docs/epics/<branch>/SPEC.md` (resolve branch: `git rev-parse --abbrev-ref HEAD`)
- `TASKS.md`
- GitNexus `context` for symbols involved in each task (if available)

## Property Categories

Read `references/property-categories.md` for the full definition of each category.

| # | Category | Coverage question |
|---|---|---|
| 1 | SAFETY | What must never happen? |
| 2 | LIVENESS | What must eventually happen? |
| 3 | INVARIANT | What must always be true? |
| 4 | BOUNDARY | What are the valid input ranges? |
| 5 | IDEMPOTENT | What is safe to run twice? |
| 6 | ORDERING | What order invariants exist? |
| 7 | ISOLATION | What cannot leak between contexts? |
| 8 | PERFORMANCE | What latency/throughput/size bounds exist? |
| 9 | SECURITY | What access controls must hold? |
| 10 | OBSERVABILITY | What must be logged or measured? |
| 11 | COMPATIBILITY | What existing behavior must be preserved? |

## Steps

### 1. Map requirements to properties

For each requirement in docs/epics/<branch>/SPEC.md, derive at least one property from each applicable category.
Use GitNexus `context` to understand what currently calls each changed symbol and what invariants
already exist in the codebase (look at existing tests for implicit invariants).

A property is stated as: `PROPERTY(type, id): <predicate>`

Example:
```
SAFETY(SAFE-001): The recording session NEVER starts without camera permission granted.
LIVENESS(LIVE-002): Once startRecording() is called, the first frame ALWAYS arrives within 3 seconds.
INVARIANT(INV-003): session.isActive == true IFF audio and video pipelines are both running.
BOUNDARY(BOUND-004): maxDurationSeconds MUST be in [1, 3600].
```

### 2. Assign properties to tasks

Each property traces to one or more tasks that must prove it. Every task in TASKS.md must have
at least one property assigned (if a task has no testable property, it is not a real task — merge
it into a related task or remove it).

### 3. Build traceability table

```
| Property ID | Category | Predicate (short) | Task IDs |
|---|---|---|---|
| SAFE-001 | SAFETY | No session without camera permission | task-001 |
```

### 4. Write docs/epics/<branch>/PROPERTIES.md

Use `assets/templates/PROPERTIES.md` as base. Include:
1. Full property list with predicates
2. Traceability table
3. Per-task property assignment (RED agents read this to know which property their test must prove)

### 4.5. Generate Observability Definitions

For every valid, quantitative property in `PROPERTIES.md` (e.g. PERFORMANCE, SAFETY errors), translate it into observability definitions.
Write the output to the `observability/` folder at the root of the repo:
- `observability/metrics/` (Metric registration snippets)
- `observability/alerts/` (Alert rules/conditions)
- `observability/dashboards/` (Dashboard panel JSON fragments)

### 5. Gate

Run `datum gate properties [--yolo]`

Validates:
1. All 11 categories have at least one property (or a justified exclusion note)
2. Every task in TASKS.md has at least one assigned property
3. Every property has a testable predicate (no vague "must work correctly" non-predicates)
4. Every quantitative property (latency, throughput, counters) has a mapped definition in the `observability/` folder.
5. If `properties_human_review = skippable_if_complete`: LLM judge evaluates completeness

On pass: write `docs/epics/<branch>/PROPERTIES.md`, update state.
On fail: surface the coverage gaps, iterate.

## Outputs

- `docs/epics/<branch>/PROPERTIES.md` — 11-category invariant set with traceability

## Failure modes

- Missing category coverage → gate held; skill proposes additions
- Vague predicate → gate held; skill rewrites to testable form
- Task with no property → merging or task removal suggested
