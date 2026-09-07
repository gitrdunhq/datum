## Refine — 2026-09-06

### Q1: [Behavior] What is the exact syntax of the `integration_failed:` error string — separator, ordering, and whether invariant ids are included alongside task ids?
> R2 requires the lane to fail with `error` starting `integration_failed:` and "listing the covered task ids from `depends_on` and the invariant ids from the acceptance criteria." R3 requires `classifyLaneError` to extract those task ids from the same string. Both the lane runner's error-string builder and the classifier's regex must agree on the exact format (e.g. `integration_failed: covered task-002, task-003; invariants INV-01, INV-03` vs. a bracketed-list or JSON-in-string variant), or the classifier's extraction will silently fail to find ids on a format change. I'm assuming a human-readable, comma-separated, semicolon-delimited two-part string — is that right, or should this be a more structured (e.g. JSON-suffix) format?

[Answer]:

### Q2: [Architecture] Does the independent test verify for an integration lane run as an additional step inside the existing `postRedSteps` batch call, or as a second, separate `runBatch` invocation?
> The ticket's Constraints say "No new phase, no new command runner call per lane beyond the existing batches" (plural). `postRedSteps` today bundles count-gate, placeholder-scan, and ownership-diff into one `datum-cli` batch call. R2's independent verify could be (a) folded into that same batch as one more step, or (b) issued as a second batch call, which would still be "beyond the existing [single] batch" in spirit even if the constraint text technically allows multiple named batches. I'm assuming (a) — extend `postRedSteps` itself to include the verify step for `expect_tests_pass` lanes — is that right, or is a second batch call acceptable?

[Answer]:

### Q3: [Architecture] Should `TriageClassification` gain a new structured field for covered task ids, or is embedding them as a substring of `reason` (extracted via regex from the `integration_failed:` error) sufficient?
> R3 says the classification must carry "the covered task ids into the classification so the halt message says which merged work broke the invariant." SPEC.md defaults to string-embedding in `reason` to minimize diff size (per AI-003 minimal-diffs), but this affects any downstream consumer of `TriageClassification` — notably `skills/src/datum-tdd-act-triage` which files GitHub issues from these classifications. I'm assuming string-embedding in `reason` is sufficient for the triage/issue-filing use case — is that right, or does the triage pipeline need a real `taskIds: string[]` field on the type?

[Answer]:

### Q4: [Behavior] What counts as "the independent test verify did not run" (null exit → `green_verify_unavailable`) for an integration lane specifically — a timeout, a missing test command in the lane spec, or something else?
> R2 says "a null exit (verify did not run) is `green_verify_unavailable`, as for any lane; never a pass." GREEN's existing verify already has this exact tri-state behavior for task lanes, but the specific conditions that produce a null exit there (e.g. no test command configured, worktree missing, command-runner crash) need confirming as identical for the integration-lane case, since an integration lane's tests are being run against the merged epic branch rather than a fresh worktree. I'm assuming the same conditions and same code path as GREEN's verify apply unchanged — is that right, or does verifying against the merged branch introduce a new "unavailable" case (e.g. merge branch not yet built/checked out)?

[Answer]:

### Q5: [Behavior] Should the RED prompt for an `expect_tests_pass` lane surface the invariant ids as a distinct list, or embed them in prose alongside the "tests must already pass" instruction?
> R1 says "The RED prompt for such a lane says the tests must pass ... and names the invariant ids they cover." AC1.4 needs a concrete, testable shape (e.g. a `contains()` check against specific id strings) to assert against. I'm assuming the invariant ids appear as plain substrings in the prompt text (e.g. "This lane covers invariants: INV-01, INV-03") rather than a structured block — is that right, or is there an existing prompt-templating convention (e.g. a fenced `## Invariants` section) this should follow instead?

[Answer]:
