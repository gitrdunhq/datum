## Refine — 2026-09-06

### Q1: [Architecture] What should the properties-derive prompt say, exactly, to elicit one Integration Invariant per answered question?
> R2 requires the properties-derive prompt to "ask for this explicitly" but the ticket gives no prompt wording. No Python module authors PROPERTIES.md directly — it's produced by an LLM/skill-template step (likely `.claude/skills/datum-properties/` or a `skills/` prompt file), which this scan did not locate. I'm assuming the fix is a template-text addition instructing the model to emit one row per answered `### Q<N>:`/`[Answer]:` pair with `Source: question:Q<N>`, phrased as a checkable expectation rather than a restatement of the question — is that the right shape, or is there an existing prompt-engineering convention in this repo's other `datum-*` skill prompts I should match instead?

[Answer]:

### Q2: [Behavior] Does "merge frontier" mean pure task-id-set grouping at plan-build time, with no dependency on runtime task-lane completion order?
> R3 defines how to *group* invariants once a frontier is identified (by sorted covered-task tuple) but not how "merge frontier" is detected, or whether `task-INT-<n>` lanes must wait for their covered task lanes to actually complete before running (as opposed to just declaring `depends_on` in the plan graph, which the existing lane scheduler already respects). I'm assuming this slice only needs to *emit* the INT lane with the correct `depends_on` at plan-build time, and that "scheduled at the merge frontier" is fully satisfied by the DAG scheduler treating `depends_on` normally (no new runtime scheduling logic) — is that right, or does "frontier" imply something more dynamic, e.g. re-evaluating invariants after tasks.json changes mid-epic?

[Answer]:

### Q3: [Integration] Should `tests/integration/` and `src/integration/` be auto-created if they don't exist, and by which step?
> R3 specifies the file paths for INT lane test files but not whether these directories pre-exist in a typical epic checkout or must be created on demand. I'm assuming the lane-plan build step (or the skeleton-creation step, per R6) creates the directory on demand if missing, the same way task skeleton file directories are handled today — is that the right owner, or should directory creation instead happen at worktree-setup time (`datum-tdd-act-setup`)?

[Answer]:

### Q4: [Behavior] Does the existing task-skeleton placeholder body (e.g. `pytest.fail("not implemented")` or equivalent) need any INT-lane-specific wording, or should it be byte-identical to task skeletons?
> R6 says INT skeletons use "the same placeholder shape task skeletons use," but since an INT lane's tests are expected to *pass* (RED-only, no GREEN, testing already-merged code — see R5), a generic "not implemented" placeholder body would be misleading if left unedited. I'm assuming the RED step (not the skeleton step) is what fills in the real assertions per invariant, and the skeleton's placeholder is purely a scaffold identical to task skeletons (same failing-by-default body) until RED writes it — is that the right division, or should the skeleton itself already reflect the "expected to pass" framing in a comment/docstring?

[Answer]:

### Q5: [Integration] What does "route triage to the covered tasks" mean operationally when an INT lane covers more than one task — file one issue per covered task, or one shared issue referencing all of them?
> The ticket's "Not This" section defers full slice-2 triage logic but this slice's R3/R9 still need the INT lane's `depends_on`/`Covers` to be shaped correctly for that future routing to work. I'm assuming this slice only needs to preserve the covered-task list faithfully (no triage code written yet) so slice 2 can route however it decides — is that scope boundary correct, or does this slice need to reserve a specific field/shape (e.g. a `covers` key on the lane object, distinct from `depends_on`) so slice-2 triage has an unambiguous source of the original covered-task set even after any depends_on manipulation?

[Answer]:

### Q6: [Architecture] When two merge-frontier groups have overlapping or dependency-conflicting covered-task sets, what tie-break should decide `task-INT-<n>` numbering?
> R3 requires "topological order of the group's tasks" for numbering but doesn't define behavior when groups' covered-task tuples partially overlap without a strict ancestor relationship (e.g. group A covers {task-1, task-2}, group B covers {task-2, task-3} — neither is a subset/ancestor of the other). I'm assuming a deterministic secondary sort by ascending covered-task-id tuple breaks all such ties — is that acceptable, or is there a preferred tie-break (e.g. insertion order from PROPERTIES.md, or invariant ID order)?

[Answer]:

### Q7: [Scope] Are Python and TypeScript the only two languages this repo's lane plans need integration-test paths for, or must the location rule be generalized/configurable?
> R3 gives exactly two path patterns (`tests/integration/test_int_<n>.py` for python, `src/integration/int-<n>.test.ts` for typescript) but doesn't state the rule for other languages. This repo's own `test_command`/language detection (used elsewhere in `lane_plan.py` for per-lane `test_command`) presumably already knows the epic's language — I'm assuming that existing detection is reused to pick between exactly these two path templates, and any other language is out of scope for this slice (falls back to erroring rather than guessing a third path convention) — is that acceptable, or should a third generic/configurable path template be added now to avoid a follow-up slice?

[Answer]:
