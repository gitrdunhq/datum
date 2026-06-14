## Refine — 2026-06-14

### Q1: [Behavior] How many times does the ruff/mypy → GREEN retry cycle loop before failing the lane?

> The existing GREEN phase has exactly one retry (lines 299–308 of `datum-tdd-act-lane.ts`): first attempt uses `balanced` (sonnet), retry escalates to `deep` (opus), and a second failure returns a failed `LaneOutcome`. I'm assuming the ruff/mypy pre-check plugs into that same single-retry ceiling — so the sequence is: GREEN attempt 1 → ruff/mypy check → if fail, GREEN attempt 2 (opus) → ruff/mypy check again → if still fail, lane fails. Is that right, or should there be a separate inner loop just for pre-checks (e.g. up to 3 ruff/mypy retries before escalating to pytest)?

[Answer]:

### Q2: [Behavior] How many lint/type errors should we pass back to the GREEN retry agent, and in what format?

> Ruff can emit hundreds of violations on a badly-formed file. Passing all of them could exceed the agent's useful context window and inflate token cost. I'm assuming we truncate to the first 10 errors ordered by line number and serialize them as compact JSON inline in the `failure_reason` string — is that the right limit and format, or do you want plain text, a different count, or errors grouped by file?

[Answer]:

### Q3: [Scope] Should ruff and mypy check only the `implFiles` from the lane plan, or all `.py` files modified since the last commit?

> `implFiles` is derived from `classifyFiles(lane.files)` at line 97 and represents the files the lane plan explicitly assigned to this lane. Checking only those avoids false positives from unrelated files touched in the same worktree. I'm assuming we check `implFiles` only — is that right, or should we run `git diff --name-only HEAD` to discover what the GREEN agent actually wrote and check that set instead?

[Answer]:

### Q4: [Integration] Should mypy use the repo's existing `pyproject.toml`/`mypy.ini` config, or a fixed flag set?

> If the repo has a `mypy` section in `pyproject.toml` or a `mypy.ini`, using it respects the project's existing type-checking strictness. If there is no config (or it is strict enough to produce many false positives on generated code), a permissive fallback like `--ignore-missing-imports` avoids blocking GREEN on stubs that are not yet installed. I'm assuming we use whatever config exists in the repo and add `--no-error-summary` for cleaner output — is that right, or should we force a specific flag set regardless of repo config?

[Answer]:

### Q5: [Architecture] Should "which check caught the error" be encoded as a string prefix in `LaneOutcome.error`, or as a new structured field?

> The minimal-diff approach is to use the existing `error?: string` field with a prefix (`ruff_lint_error: file:line code message`, `mypy_type_error: ...`), matching the pattern already used by `green_blindness_violation:`, `file_ownership_violation:`, etc. This requires no schema changes. The alternative is adding `pre_check_failure?: 'ruff' | 'mypy' | null` to `LaneOutcome` in `types.ts`, which gives downstream consumers (triage agent, future dashboards) a typed field to filter on — but touches the interface and all its consumers. I'm assuming string prefix is fine — is that right, or do you want the structured field?

[Answer]:

### Q6: [Integration] Confirm ruff and mypy are resolvable in the agent sandbox PATH.

> The ticket says both tools are "already in the dev environment," and I'm treating that as true. Before implementing, it's worth verifying with `which ruff && ruff --version` and `which mypy && mypy --version` in the worktree environment. If either is missing, the spec's fail-open behavior (skip the check, log a warning) means the lane still works — but the feature provides zero value for that tool. Can you confirm both are present, or should the implementation treat absence as a hard error?

[Answer]:
