# Integration lanes: cross-task invariants become RED-only lanes scheduled at their merge frontier

## What

Integration is a lane, not a phase. Today the pipeline verifies each task in isolation (RED, GREEN, skeptic, REFACTOR per lane) and nothing checks that merged lanes hold the epic's cross-task invariants together. The three consumer epics that closed out this week (eedom #521, #562, #566; elonChesd epic-1, playable-ui-shell) each escaped at least one integration defect to Review or later: caliper #566 task-001 mirrored a neighbouring fnmatch matcher although the answered Refine question Q1 specified path-aware globstar, and the skeptic caught it but Review did not; the Shroud epic shipped four DOM-visible defects that every unit-level check missed.

This slice makes the Properties phase emit cross-task invariants tagged with the tasks they span, plus one property per answered QUESTIONS.md item, and makes the Plan phase schedule a synthetic `task-INT-<n>` lane per merge frontier whose RED writes those invariants as tests against the merged dependencies. An INT lane is RED-only: there is no GREEN. If its tests fail against the merged tree, that is a real integration defect, and triage routes it to the covered tasks, never to the INT lane. Everything else (worktrees, markers, the count gate, the read witness, the verify batch, merge) is the existing Act machinery unchanged.

Issues this slice closes: #444 (synthetic task-INT lane), #461 (a property per answered question). Later slices, not this one: #445 (skeptic sees the dependency closure), #448 (regression test per fixed skeptic finding), #446 (random-walk invariants), #447 (seam gate), #457 (Playwright gate).

## Requirements

R1. `datum properties` output (PROPERTIES.md) gains a section `## Integration Invariants` whose entries are a table with columns `ID | Invariant | Covers | Source`. `Covers` is a comma-separated list of task ids from tasks.json (two or more for a cross-task invariant; one is allowed when the source is an answered question). `Source` is `spec:<section>` or `question:Q<N>`.

R2. Every answered question in QUESTIONS.md (a `### Q<N>:` heading followed by a non-empty `[Answer]:`) yields exactly one Integration Invariant whose `Source` is `question:Q<N>` and whose `Invariant` states the answer as a checkable expectation. A question with an empty answer yields none. The properties-derive prompt asks for this explicitly and `datum gate properties` fails with `invariant_missing_for_question: Q<N>` when an answered question has no invariant.

R3. `datum lane-plan` reads the Integration Invariants and emits, in addition to the task lanes, one synthetic lane per merge frontier: the set of invariants whose `Covers` tasks are all present is grouped by the sorted tuple of those tasks; each group becomes lane `task-INT-<n>` (n from 1, in topological order of the group's tasks) with `depends_on` equal to the covered tasks, `files` equal to one new test file under the repo's integration test directory (`tests/integration/test_int_<n>.py` for python, `src/integration/int-<n>.test.ts` for typescript), `acceptance_criteria` equal to the group's invariant texts, and `kind: "integration"`. An invariant that covers a task not in tasks.json is `invariant_covers_unknown_task: <ID> -> <task>` and fails `datum gate plan`.

R4. The lane-plan digest (`datum lane-plan-digest`) and the per-lane spec export (`datum lane-spec-export`) carry `kind` through unchanged (`task` when absent, so every plan written before this slice reads as all task lanes), and the exported lane spec for an integration lane carries `expect_tests_pass: true`.

R5. The lane-spec export's `contract_summary` for an integration lane states that the tests are expected to PASS against the existing merged code and must not be written to fail, so the RED agent's prompt carries it without a TypeScript change.

R6. `datum skeleton --batch` creates the integration test file for each `task-INT-<n>` lane with one skeleton test per invariant, named from the invariant ID, in the same placeholder shape task skeletons use.

R7. The per-lane `ac_count` in the exported spec of an integration lane equals the number of its invariants, so the existing count gate requires one new test function per invariant with no change to the gate.

R8. A plan with zero Integration Invariants schedules zero INT lanes and is otherwise unchanged; `datum gate plan` warns `no_integration_invariants` on stderr rather than failing.

R9. `datum gate plan` verifies every `task-INT-<n>` lane's `depends_on` equals its invariants' union of `Covers`, and that no task lane depends on an INT lane.

R10. docs/FLOW.md gains a section describing integration lanes (RED-only, scheduled at the merge frontier, failures routed to covered tasks) and SKILL.md documents `kind: integration` and the two new gate names.

## Not This

- No TypeScript in this slice. The lane runner's integration branch (RED-only: intake, RED, post-RED gates, independent test-verify, then stop; `integration_failed: <IDs> — <first failing test>` on a red suite; a new `integration` triage category routed to the covered tasks) is slice 2, run as its own epic with `test_command` set to vitest, because this repo's datum config tests with pytest and a lane whose tests are TypeScript cannot be verified here. Until slice 2 lands, an INT lane runs the full task path; its GREEN is expected to find nothing to implement.
- No automatic fix lane: an integration failure is filed and named; re-opening the covered tasks is a later slice.
- No skeptic dependency closure (#445), no regression-test-per-finding gate (#448), no random-walk invariants (#446), no seam gate (#447), no Playwright gate (#457).
- No change to how task lanes run.
- No new agent type; INT lanes use the existing datum-red agent with an integration-specific prompt variant.
- No epic-level `task-INT-all` lane in this slice; frontier lanes only.
