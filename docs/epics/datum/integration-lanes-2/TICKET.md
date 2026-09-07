# Integration lanes, slice 2a: an integration lane runs RED-only, end to end

## Why

Slice 1 (epic `datum/integration-lanes`, closed 2026-09-06) makes Properties emit an `## Integration Invariants` table and makes Plan schedule one `task-INT-<n>` lane per merge frontier, RED-only in intent. At runtime the lane runner still treats an integration lane like any task lane: RED must fail, then GREEN, the skeptic panel and REFACTOR run. For an integration lane that is backwards. The covered tasks have already merged, so its tests must pass on the first run, and a red test is the finding, not a stage to fix.

## What this slice delivers

One thing a real `datum go` run can do afterwards that it cannot do today: an integration lane (`kind: "integration"`, `expect_tests_pass: true`) runs RED only, its tests are verified independently to pass against the merged epic branch, and when they do not the lane halts by the name `integration_failed`, naming the covered tasks (`depends_on`) rather than the integration lane itself.

## Requirements

R1. In `skills/src/datum-tdd-act-lane.ts`, a lane whose spec carries `expect_tests_pass: true` runs RED, the post-RED deterministic batch (count gate, placeholder scan, ownership), and an independent test verify; it does not run reflect, GREEN, the skeptic panel or REFACTOR. The RED prompt for such a lane says the tests must pass, because the code under test is already merged, and names the invariant ids they cover.

R2. The independent verify decides the lane. Exit 0: the lane completes at stage RED with `follow_ups` unchanged. Non-zero: the lane fails with `error` starting `integration_failed:` and listing the covered task ids from `depends_on` and the invariant ids from the acceptance criteria. A null exit (verify did not run) is `green_verify_unavailable`, as for any lane; never a pass.

R3. `skills/src/shared/triage-classify.ts` classifies `integration_failed` as a code defect in the covered tasks (category `agent_behavior` is wrong: the RED agent did its job), with the covered task ids carried into the classification so the halt message says which merged work broke the invariant.

R4. `datum lane-spec-export` includes `expect_tests_pass` and the covered task ids in the exported lane spec, so the RED agent and the runner read them from the same hash-verified file every stage already reads.

R5. `docs/FLOW.md` §3 describes the integration lane path in one paragraph beside the task lane path, and the §5 ledger entry for slice 1 is updated to say RED-only execution shipped. `SKILL.md` lists `integration_failed` as a live failure name, no longer reserved.

R6. Real ride: this epic's own Properties phase derives at least one integration invariant across its tasks, Plan schedules the integration lane, and the lane runs RED-only in this epic's Act. If Plan produces no integration lane, that is a defect of this slice, not a pass.

## Constraints

- Decompose into vertical slices: each task is a shippable, testable unit cut through every layer it needs (runner, prompt, classifier, export, docs). The first task is the thinnest end-to-end path: one integration lane runs RED-only and completes green. A task that only touches one layer ("the classifier", "the prompt", "the docs") is not a task in this epic. The plan gate warns `plan_not_sliced` when no task crosses a layer; a plan that draws that warning should be redone, not approved.
- Generated bundles (`skills/*.js`) are never lane files; lanes edit `skills/src/**` and the build regenerates them.
- No new phase, no new command runner call per lane beyond the existing batches.
- Out of scope, slice 2b and 2c: the prove-it-can-fail mutation check (`integration_test_vacuous`) and turning `plan_not_sliced` into a halt.

## Acceptance

- A vitest test drives the lane runner with a fake agent through an integration lane and observes: RED called once, no reflect/GREEN/skeptic/REFACTOR calls, verify batch run once, outcome `completed` at stage RED on exit 0 and `integration_failed` naming the covered tasks on exit 1.
- The classifier test maps `integration_failed: … covered task-002, task-003 …` to a code-defect category carrying those ids.
- This epic's Act log shows one `task-INT-<n>` lane completing RED-only.
