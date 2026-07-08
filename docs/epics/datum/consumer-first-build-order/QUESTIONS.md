## Refine — 2026-07-07

### Q1: [Behavior] Should build-order inference at plan time ever read real file stubs/source, or is SPEC-description-only inference sufficient in all cases?
> The ticket's "Not This" section directs an LLM-driven approach reading the SPEC's own file list and descriptions, not an AST/import-graph parser. I'm assuming this holds even in edge cases like re-planning an existing epic where some files may already exist on disk — is that right, or should `datum-plan` opportunistically read real file contents when they're already present (e.g. incremental re-plan, or a lane created earlier in the same run) to sharpen the inference?

[Answer]:

### Q2: [Integration] Does `datum-tdd-act-lane` read upstream dependency files directly from the shared worktree, or does something need to explicitly surface a completed lane's output files?
> Requirement 2 needs the full source of every file in a lane's `depends_on` chain. No existing mechanism was found that captures "these are the files lane X produced" as a discrete signal — I'm assuming `datum-tdd-act-lane` can just read the dependency files directly off the shared worktree filesystem once the DAG scheduler in `datum-tdd-act.ts`/`datum-go.ts` confirms the upstream lane completed, using `classifyFiles`/`lane.files` to know which paths to read. Is that right, or does `datum-tdd-act`/`datum-go` need a new explicit "lane completed, here are its output paths" handoff that `datum-tdd-act-lane` should consume instead?

[Answer]:

### Q3: [Integration] How should `context_files` paths in `.datum/config.json` be resolved?
> The config schema has no existing path-resolution precedent to point to for a new array-of-paths key. I'm assuming paths are resolved relative to the project root (matching how `skills_dir` and other config paths are typically anchored in this codebase) — is that right, or should they resolve relative to the `.datum/config.json` directory itself, or the current working directory when `datum-plan` runs?

[Answer]:

### Q4: [NFR] Is there a token/size budget for cumulative `upstream_source` context when a lane has a deep or wide `depends_on` chain?
> As dependency chains get longer, injecting full upstream source into every downstream lane's packet could grow unbounded. I'm assuming no explicit budget is needed for this first iteration — scoping injection to `implFiles` only (excluding test files, per the existing `classifyFiles` convention) is treated as sufficient mitigation. Is that right, or do you want a hard size/token cap with truncation, summarization, or an explicit error when a lane's cumulative upstream context exceeds it?

[Answer]:

### Q5: [Behavior] When the inferred import graph contains a cycle, should `datum-plan` auto-merge the cyclic files into one lane, or always halt and require human intervention?
> The ticket doesn't specify cycle-handling behavior. I'm assuming, per the project's fail-fast / no-silent-fallback convention, that `datum-plan` should halt with an explicit error naming the cyclic file set and let the Gate step or the user resolve it, rather than automatically merging the files into a single lane. Is that right, or would you prefer automatic merging as the default with a warning, reserving the hard halt for cases the merge can't resolve cleanly?

[Answer]:
