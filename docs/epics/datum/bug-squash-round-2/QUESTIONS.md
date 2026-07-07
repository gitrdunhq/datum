## Refine — 2026-07-07

### Q1: [Architecture] Should each of the ten bugs be its own lane, or should related bugs be grouped into shared lanes?
> The ticket lists ten independent bugs across disjoint files (local_llm.py, datum-tdd-act-lane.ts, skeleton_creator.py, datum-go.ts, closeout_cmd.py, commit_closeout.py, datum-closeout.ts, memory_extract.py, datum-tdd-act-setup.ts, worktree_manager.py) with no shared edit surface. SPEC.md assumes one-lane-per-bug (A1) to maximize parallelism and simplify per-issue commit trailers. If you'd rather group related bugs (e.g. the three closeout bugs #301/#302/#303 into one lane since they share `datum closeout`), lane-plan.json needs to be built differently before dispatch.

[Answer]:

### Q2: [NFR] Is regression-test coverage per bug sufficient to verify "no behavior change to lanes/phases not named above," or do you also want manual verification / a CI gate?
> SPEC.md assumes (A2) that each fix's regression test plus `gitnexus_detect_changes()` scoped-change check is enough to satisfy the ticket's non-regression requirement. If you want an additional full pipeline smoke run (e.g. a dry-run of `datum-go` end-to-end) before merge, that changes the lane's Definition of Done and adds a merge-gate step.

[Answer]:

### Q3: [Behavior] What exact commit trailer format should reference each GitHub issue — `Fixes #N`, `Closes #N`, or a custom trailer?
> SPEC.md assumes (A4) `Fixes #<N>` since it's the standard GitHub auto-close convention and matches this repo's existing inline-issue-reference precedent (e.g. skeleton_creator.py comments citing #235/#231). If your GitHub issue-closing automation or org convention expects `Closes #N` or a different trailer key entirely, every lane's commit template needs to match that instead.

[Answer]:

### Q4: [Scope] Is there a required or recommended execution order across the ten bugs, or can lanes run in any order / fully parallel?
> SPEC.md assumes (A3) all ten bugs are independently fixable with zero inter-dependencies, based on the codebase scan showing disjoint files and no cross-references between fix points. If there's a hidden ordering constraint (e.g. #213's branch-bootstrap fix should land before others so future epics can use it immediately), lane-plan dispatch order and merge sequencing need to reflect that.

[Answer]:

### Q5: [Scope] For #270, which specific languages/test-package conventions does "conflicts with real test-package conventions for compiled languages" refer to — and what's the expected fallback behavior for those cases?
> SPEC.md's R3 (A5) interprets this broadly as "any test convention that maps to a directory/package rather than a single file extension," without enumerating specific languages, since the ticket text doesn't name any and skeleton_creator.py has no existing per-language enumeration to anchor a narrower reading. If you have concrete examples in mind (e.g. specifically Swift XCTest, or specifically JVM test source sets, or something else entirely), naming them would let R3's acceptance criteria target exact test cases instead of a generic directory-vs-file-extension distinction.

[Answer]:

### Q6: [Behavior] For #307, should testCommand validation hard-fail (block lane dispatch entirely) or soft-warn (alert and proceed anyway)?
> SPEC.md's R9 (A6) assumes hard-fail, on the reasoning that dispatching lanes with a broken testCommand wastes worktree setup and lane-agent time on a doomed run. If you'd rather have setup warn and let the operator decide whether to proceed (e.g. because the validation itself might have false positives for unusual sub-package layouts), R9's acceptance criteria need to change from "setup halts" to "setup warns and continues."

[Answer]:
