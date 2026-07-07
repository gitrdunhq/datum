# PROPERTIES: Bug Squash Round 2

Derived from `SPEC.md` (11 requirements: R1-R11) and `TASKS.md` (10 tasks). Each property is
independently testable and traceable to the requirement(s) and task(s) it constrains.

---

## 1. Property List (grouped by category)

### SAFETY — what must NEVER happen

- PROPERTY(SAFETY-001): `_load_raw_config()`/`load_config()` never raise a raw, unhandled `tomllib.TOMLDecodeError` to the caller — a duplicate `[local_llm]` table is always converted to a named `ValueError`/`DatumConfigError`. (R1)
- PROPERTY(SAFETY-002): `verifyFileOwnership` never classifies a changed file as "allowed" solely because its name is a suffix/substring of an allowed file's name (e.g. `NewFoo.test.ts` vs `Foo.test.ts`). (R2)
- PROPERTY(SAFETY-003): `skeleton_creator`'s extended stub logic never generates a flat-extension test-file stub for a task declared as docs-only or as a directory/package-style test convention. (R3)
- PROPERTY(SAFETY-004): `datum init`'s adopt-existing-branch path never adopts a branch with uncommitted conflicting state or unsafe divergence from base — it exits non-zero instead of mutating epic state. (R4)
- PROPERTY(SAFETY-005): closeout's branch-slug detection never silently returns `epic_number=0` for an unrecognized branch when no explicit override is supplied — it always emits a warning signal. (R5)
- PROPERTY(SAFETY-006): the git-derived Delivery fallback never overwrites/corrupts the lane-state-derived path when lane-state IS present (fallback only activates when lane-state is absent). (R6)
- PROPERTY(SAFETY-007): closeout never prints the success checkmark for walkthrough generation when the LLM-produced content is empty/degraded. (R7)
- PROPERTY(SAFETY-008): memory extraction never surfaces a match found solely inside a JSON tool_use/tool_result blob, raw code block, or file-path-only line as high-confidence. (R8)
- PROPERTY(SAFETY-009): lane dispatch never proceeds to worktree distribution when `testCommand` validation fails for any lane. (R9)
- PROPERTY(SAFETY-010): `cleanup_run_worktrees()` never deletes a lane branch that has one or more commits ahead of its epic/base branch, regardless of worktree-dir presence. (R10)
- PROPERTY(SAFETY-011): no fix commit changes behavior of a symbol/file outside the ten named bugs (no incidental blast radius). (R11)

### LIVENESS — what must EVENTUALLY happen

- PROPERTY(LIVENESS-001): a valid single-`[local_llm]` config file (default asset, project, or bootstrap template) is eventually parsed and returned as a dict — loading always terminates in success or a named error, never hangs/loops. (R1)
- PROPERTY(LIVENESS-002): a genuinely out-of-scope changed file always eventually raises `file_ownership_violation` (R2 AC3 negative-path completeness).
- PROPERTY(LIVENESS-003): every task shape (flat-extension, directory/package, docs-only) eventually resolves to a stub-generation decision — no task shape is left unhandled/falls through. (R3)
- PROPERTY(LIVENESS-004): a non-default branch with no `TICKET.md`/lane-plan artifacts and no unsafe state is eventually adopted, producing `epicBranch`/`lanePlanPath` state without requiring a manual `datum init` workaround. (R4)
- PROPERTY(LIVENESS-005): every branch name (recognized pattern, override, or unrecognized) eventually produces either a resolved `epic_number` or an explicit warning — detection always terminates with one of the two outcomes. (R5)
- PROPERTY(LIVENESS-006): RETRO.md's Delivery section always eventually contains a non-0/0 count when git history has ≥1 `green(task-N)` commit on the epic branch and lane-state is absent. (R6)
- PROPERTY(LIVENESS-007): closeout always eventually completes (does not hard-abort) even when walkthrough generation degrades to empty. (R7)
- PROPERTY(LIVENESS-008): a clean transcript with a genuine correction statement and no noise always eventually yields that statement as a high-confidence candidate (extraction is not over-suppressed into producing nothing). (R8)
- PROPERTY(LIVENESS-009): a valid, runnable `testCommand` always eventually passes validation and lane setup proceeds to dispatch. (R9)
- PROPERTY(LIVENESS-010): every lane branch matching `refs/heads/<epic_branch>--*` is eventually enumerated by cleanup, whether or not its worktree dir exists on disk. (R10)

### INVARIANT — what must ALWAYS be true

- PROPERTY(INVARIANT-001): the returned config dict's shape/keys are identical whether loaded via the pre-fix happy path or the post-fix wrapped path, for any valid single-`[local_llm]` file. (R1)
- PROPERTY(INVARIANT-002): for any changed-file/allowed-file pair, `verifyFileOwnership`'s classification is determined by exact path equality or path-segment-boundary match only — never by `String.endsWith`/substring alone. (R2)
- PROPERTY(INVARIANT-003): the extension-matching decision function is a total function over {flat-extension, directory/package, docs-only} task shapes — always returns exactly one stub decision, never both a stub and a skip for the same task. (R3)
- PROPERTY(INVARIANT-004): after a successful adopt, `epicBranch` and `lanePlanPath` conform to the exact state shape consumed by plan/act/setup/lane/merge/closeout phases (structural equality with the manually-`datum init`-produced shape). (R4)
- PROPERTY(INVARIANT-005): explicit `--epic-number` override, when supplied, always takes precedence over regex-inferred detection regardless of branch name shape. (R5)
- PROPERTY(INVARIANT-006): the Delivery section's provenance label (`git-derived` vs `lane-state-derived`) always accurately reflects which code path produced the numbers shown. (R6)
- PROPERTY(INVARIANT-007): the walkthrough status indicator (checkmark vs degraded-mode) is always a pure function of whether returned content is LLM-produced/non-empty. (R7)
- PROPERTY(INVARIANT-008): confidence tagging is always monotonic with noise-classification — a match inside detected noise is never tagged strictly higher confidence than an equivalent match in clean prose. (R8)
- PROPERTY(INVARIANT-009): the CLI validation subcommand's exit code is always non-zero iff `testCommand` is non-runnable against the lane's target sub-package files. (R9)
- PROPERTY(INVARIANT-010): a lane branch's deletion-eligibility is always exactly `commits_ahead_of_base == 0`, independent of worktree-dir presence. (R10)
- PROPERTY(INVARIANT-011): every fix commit's message contains a trailer matching `Fixes #<N>` where `<N>` is the issue number named in R1-R10. (R11)

### BOUNDARY — valid input ranges

- PROPERTY(BOUNDARY-001): a config file with exactly one `[local_llm]` table parses successfully; a config file with exactly two (or more) `[local_llm]` headers triggers the named error — the boundary is table-count > 1, not file size or other property. (R1)
- PROPERTY(BOUNDARY-002): path-boundary matching treats a path-segment boundary (`/` or full-string start/end) as the only valid match boundary; a match ending mid-segment (e.g. `Foo.test.ts` inside `NewFoo.test.ts` with no `/` boundary before it) is invalid. (R2)
- PROPERTY(BOUNDARY-003): a task's test-convention field accepts either a single flat extension string, a directory/glob path, or an explicit docs-only marker — any other shape is rejected/unhandled with a clear signal, not silently coerced. (R3)
- PROPERTY(BOUNDARY-004): adoption is permitted only when branch != default branch AND no `TICKET.md`/lane-plan artifacts exist AND no uncommitted conflicting/divergent state — all three conditions are required; any one failing moves to the non-adopt/error boundary. (R4)
- PROPERTY(BOUNDARY-005): the branch-slug regex boundary recognizes exactly `epic-(\d+)` and `bug-squash-(\d+)` — any other slug shape (including partial matches like `epic-abc` or `bug-squash-`) falls to the unrecognized/warning path. (R5)
- PROPERTY(BOUNDARY-006): the git-fallback delivery count is bounded to commits reachable on the epic branch matching the `green(task-N)` trailer convention — commits on unrelated branches or non-matching trailers are excluded from the count. (R6)
- PROPERTY(BOUNDARY-007): the degraded-mode indicator triggers exactly when walkthrough content length/emptiness crosses the empty-fallback boundary (`_write_fallback` output vs LLM-produced output) — not on partial/short-but-real content. (R7)
- PROPERTY(BOUNDARY-008): noise-classification boundary — a line is classified as noise iff it matches a JSON tool_use/tool_result shape, is a fenced code block, or is a bare file-path-only line; prose lines containing code-like tokens but with surrounding natural language are not misclassified as noise. (R8)
- PROPERTY(BOUNDARY-009): `testCommand` validation boundary is "runnable against the lane's targeted sub-package files" — a command valid in the repo root but not against the lane's sub-package scope is treated as invalid. (R9)
- PROPERTY(BOUNDARY-010): the zero-commits boundary for lane-branch deletion is `commits_ahead == 0` exactly; `commits_ahead >= 1` is always the "keep" boundary, with no off-by-one tolerance. (R10)

### IDEMPOTENT — what is safe to run twice

- PROPERTY(IDEMPOTENT-001): calling `load_config()`/`_load_raw_config()` twice on the same duplicate-table file produces the same named error both times (no state mutation on first failed attempt). (R1)
- PROPERTY(IDEMPOTENT-002): calling `verifyFileOwnership` twice with identical changed/allowed/forbidden inputs produces identical violation results both times. (R2)
- PROPERTY(IDEMPOTENT-003): running skeleton stub generation twice for the same task shape produces the same stub-target decision and does not duplicate/clobber an already-generated stub. (R3)
- PROPERTY(IDEMPOTENT-004): running `datum init`'s adopt path twice on an already-adopted branch either no-ops (detects existing `TICKET.md`/lane-plan artifacts and refuses re-adoption) or is a safe overwrite-free re-detection — it never double-creates conflicting epic state. (R4)
- PROPERTY(IDEMPOTENT-005): calling `detect_context()` twice with the same branch/override inputs returns the identical `epic_number`/warning outcome both times. (R5)
- PROPERTY(IDEMPOTENT-006): regenerating RETRO.md's Delivery section twice from the same git history (lane-state still absent) produces the same git-derived count and label both times. (R6)
- PROPERTY(IDEMPOTENT-007): running `generate_walkthrough` twice against the same failing LLM escalation produces the same degraded-mode indicator both times (no flip-flop between checkmark and failure across runs). (R7)
- PROPERTY(IDEMPOTENT-008): re-running memory extraction on the same transcript twice yields the same set of high-confidence candidates both times. (R8)
- PROPERTY(IDEMPOTENT-009): re-running `testCommand` validation twice against the same lane/sub-package state produces the same pass/fail result both times. (R9)
- PROPERTY(IDEMPOTENT-010): running `cleanup_run_worktrees()` twice in a row is safe — the second run finds no remaining zero-commit orphan branches to delete (already-deleted branches are not re-processed/erroring). (R10)

### ORDERING — order invariants

- PROPERTY(ORDERING-001): config parsing must attempt the load before any downstream consumer (e.g. lane dispatch, model selection) reads config values — the actionable error must surface before any partial/garbage config is used. (R1)
- PROPERTY(ORDERING-002): `verifyFileOwnership` is invoked at both RED (L517) and GREEN (L639) stages in that order, and the path-boundary fix applies identically at both call sites (no ordering-dependent divergence between RED and GREEN checks). (R2)
- PROPERTY(ORDERING-003): stub-target decision must be resolved before `build_impl_stubs` writes any file, so an unknown/rejected convention shape is caught pre-write, not post-write. (R3)
- PROPERTY(ORDERING-004): adoption safety checks (uncommitted state, divergence) must run and resolve *before* `epicBranch`/`lanePlanPath` state is written — never write-then-validate. (R4)
- PROPERTY(ORDERING-005): explicit `--epic-number` override check must be evaluated before the regex-inference path runs (or its result must short-circuit regex output) — override precedence is an ordering guarantee, not just a value guarantee. (R5)
- PROPERTY(ORDERING-006): the lane-state-present check must be evaluated before the git-fallback path is invoked — fallback only triggers after confirming absence. (R6)
- PROPERTY(ORDERING-007): the checkmark/degraded-mode decision must be made only after `generate_walkthrough`'s LLM escalation attempt has fully resolved (success, fallback, or exception) — never decided speculatively before escalation completes. (R7)
- PROPERTY(ORDERING-008): noise-filtering must be applied to transcript text before `CORRECTION_PATTERNS` regex matching runs on it — never pattern-match first and filter after (filtering-after would already have surfaced false positives into results). (R8)
- PROPERTY(ORDERING-009): `testCommand` validation must run and pass before any worktree is created/lane batch is dispatched — validation strictly precedes distribution. (R9)
- PROPERTY(ORDERING-010): lane-branch enumeration (via `git for-each-ref`) must occur, and commits-ahead must be computed, before any deletion call — never delete-then-check. (R10)
- PROPERTY(ORDERING-011): task `validate-testcommand-before-dispatch` (R9) must not begin execution until `adopt-existing-feature-branch` (R4) has merged, per the declared TASKS.md dependency edge. (R9/R4 cross-cutting)

### ISOLATION — what cannot leak between contexts

- PROPERTY(ISOLATION-001): a duplicate-`[local_llm]`-table error from one config file/session never affects parsing of a different, valid config file loaded in the same process. (R1)
- PROPERTY(ISOLATION-002): `verifyFileOwnership`'s allowed/forbidden-file evaluation for one lane never leaks matches from another lane's `allowedFiles`/`forbiddenFiles` sets. (R2)
- PROPERTY(ISOLATION-003): a task's test-convention declaration (directory/package vs flat vs docs-only) is scoped to that task only — it does not alter stub-generation behavior for sibling tasks in the same epic. (R3)
- PROPERTY(ISOLATION-004): adopting one feature branch as an epic branch does not mutate or reference state from any other epic's `epicBranch`/`lanePlanPath`. (R4)
- PROPERTY(ISOLATION-005): closeout's `epic_number` resolution for one branch/run does not leak into or override another concurrently-processed run's context. (R5)
- PROPERTY(ISOLATION-006): the git-derived Delivery fallback for one run only counts commits reachable from that run's epic branch — not commits from other epics' branches. (R6)
- PROPERTY(ISOLATION-007): a walkthrough degraded-mode indicator for one closeout run does not persist into or affect the status shown by a subsequent, independent closeout run. (R7)
- PROPERTY(ISOLATION-008): noise-filtering decisions made on one transcript segment do not affect confidence scoring of matches in an unrelated transcript segment/session. (R8)
- PROPERTY(ISOLATION-009): `testCommand` validation for one lane's sub-package scope never validates against or is satisfied by another lane's sub-package files. (R9)
- PROPERTY(ISOLATION-010): cleanup for one `run_id`'s lane branches (`<epic_branch>--*`) never enumerates or deletes lane branches belonging to a different epic branch's namespace. (R10)

### PERFORMANCE — latency/throughput/size bounds

- PROPERTY(PERFORMANCE-001): the wrapped config-load error path adds no more than a single extra parse attempt/negligible overhead vs. the current direct `tomllib.load()` call — no added retry storm. (R1)
- PROPERTY(PERFORMANCE-002): path-boundary matching in `verifyFileOwnership` remains O(n·m) (changed files × allowed/forbidden files) or better — no regression to a more expensive algorithm for typical lane-sized file lists. (R2)
- PROPERTY(PERFORMANCE-003): extended stub-decision logic does not add more than a constant-factor overhead per task compared to the existing single-extension check. (R3)
- PROPERTY(PERFORMANCE-004): the adopt-branch safety check (divergence/uncommitted-state detection) completes within the same order-of-magnitude time as existing `datum init` git-status calls (no full-history scan). (R4)
- PROPERTY(PERFORMANCE-005): the broadened branch-slug regex adds no measurable overhead to `detect_context()` (single additional alternation, not a loop over patterns). (R5)
- PROPERTY(PERFORMANCE-006): the git-log-based Delivery fallback scan is bounded to the epic branch's own commit range (not a full-repo history walk). (R6)
- PROPERTY(PERFORMANCE-007): the checkmark/degraded-mode decision adds no additional LLM calls beyond the existing escalation attempt. (R7)
- PROPERTY(PERFORMANCE-008): noise-filtering preprocessing on transcripts does not exceed linear time in transcript size (no quadratic blowup from added regex passes). (R8)
- PROPERTY(PERFORMANCE-009): `testCommand` validation completes within a bounded timeout before lane dispatch, per DPS-200-style timeout discipline (no unbounded hang blocking all lanes). (R9)
- PROPERTY(PERFORMANCE-010): `git for-each-ref` + commits-ahead enumeration in cleanup scales linearly with the number of lane branches for the run, not with total repo branch count. (R10)

### SECURITY — access controls

- PROPERTY(SECURITY-001): the actionable config error message does not leak secrets/credential values that might appear elsewhere in the config file — only the file path and structural fact (duplicate table) are named. (R1)
- PROPERTY(SECURITY-002): path-boundary matching in `verifyFileOwnership` cannot be bypassed via path traversal tricks (e.g. `../Foo.test.ts` normalizing to an allowed path it shouldn't). (R2)
- PROPERTY(SECURITY-003): the directory/glob test-convention accepted by skeleton_creator does not allow a task to declare a glob that escapes the epic's working tree (no arbitrary filesystem write via convention path). (R3)
- PROPERTY(SECURITY-004): the adopt-existing-branch CLI path never adopts a branch outside the current git repository's remote/local scope (no cross-repo branch confusion). (R4)
- PROPERTY(SECURITY-005): an explicit `--epic-number` override is validated as a positive integer before being trusted (no injection via malformed override value into downstream paths/queries). (R5)
- PROPERTY(SECURITY-006): git-log commit-message parsing for the Delivery fallback safely handles adversarial/malformed commit messages (no code execution or path injection from a crafted `green(task-N)`-like trailer). (R6)
- PROPERTY(SECURITY-007): the degraded-mode indicator does not leak internal LLM error details (stack traces, API keys) into the closeout console output — only a sanitized status message. (R7)
- PROPERTY(SECURITY-008): noise-filtering does not exfiltrate or persist raw tool_use/tool_result JSON blobs (which may contain secrets) into the extracted-memory output — noise lines are dropped, not stored. (R8)
- PROPERTY(SECURITY-009): the `testCommand` validation subcommand executes the candidate command in a scoped/sandboxed context consistent with existing lane execution controls — it does not grant broader shell access than the lane's own execution model. (R9)
- PROPERTY(SECURITY-010): branch deletion in cleanup only targets branches matching the `refs/heads/<epic_branch>--*` namespace for the run's own epic — it cannot be tricked into deleting an arbitrary unrelated branch via crafted naming. (R10)

### OBSERVABILITY — what must be logged or measured

- PROPERTY(OBSERVABILITY-001): a duplicate-`[local_llm]`-table failure is logged/surfaced with the offending file path, at minimum at error level, before any pipeline abort. (R1)
- PROPERTY(OBSERVABILITY-002): a `file_ownership_violation` raised by the fixed matcher includes enough detail (changed file, matched/unmatched allowed/forbidden entries) to diagnose why it fired. (R2)
- PROPERTY(OBSERVABILITY-003): skeleton_creator logs/reports which convention shape (flat/directory/docs-only) it selected for each task, for auditability. (R3)
- PROPERTY(OBSERVABILITY-004): the adopt-branch CLI path logs the detected branch name, artifact-presence check result, and safety-check result before proceeding or failing. (R4)
- PROPERTY(OBSERVABILITY-005): `detect_context()`'s warning for an unrecognized branch slug is emitted at a visible level (not swallowed into a debug-only log) and states the branch name that failed to match. (R5)
- PROPERTY(OBSERVABILITY-006): the git-derived Delivery count is accompanied by a visible provenance label (`git-derived`) distinguishing it from lane-state-derived counts in the rendered RETRO.md. (R6)
- PROPERTY(OBSERVABILITY-007): the degraded-mode walkthrough indicator is visible in the CLI output stream (not only in a log file) so a human running closeout interactively sees it. (R7)
- PROPERTY(OBSERVABILITY-008): filtered-out noise candidates are countable/loggable (e.g. a count of skipped noise matches) to support future tuning of the noise filter. (R8)
- PROPERTY(OBSERVABILITY-009): a failed `testCommand` validation reports the lane identifier and the specific failure reason in its error output. (R9)
- PROPERTY(OBSERVABILITY-010): every lane branch deleted by orphan cleanup is logged by name and by the commits-ahead count (0) that justified deletion. (R10)
- PROPERTY(OBSERVABILITY-011): every fix commit's diff is checked via `gitnexus_detect_changes()` (or equivalent) prior to commit, and the scoped-symbol result is reviewable/reportable. (R11)

### COMPATIBILITY — existing behavior that must be preserved

- PROPERTY(COMPATIBILITY-001): `assets/config.toml.default`, `.datum/config.toml`, and the epic-26 bootstrap template all continue to load unchanged (same parsed dict) after the R1 fix. (R1)
- PROPERTY(COMPATIBILITY-002): an exact-path-match allowed-file case (`src/Foo.test.ts` changed, `src/Foo.test.ts` allowed) continues to produce no violation after the R2 fix. (R2)
- PROPERTY(COMPATIBILITY-003): an existing single-flat-extension task continues to generate the identical stub-target it did before the R3 change. (R3)
- PROPERTY(COMPATIBILITY-004): a default-branch or artifact-present scenario continues to skip adoption and behave exactly as before the R4 change (manual `datum init` flow unaffected). (R4)
- PROPERTY(COMPATIBILITY-005): `detect_context(branch='epic-23', epic_number=None)` continues to return `epic_number=23` exactly as before the R5 change. (R5)
- PROPERTY(COMPATIBILITY-006): when `.datum/runs/<runId>/lane-state/` IS present, RETRO.md's Delivery section is produced via the unchanged pre-existing lane-state path (byte-for-byte logic, not just count-for-count). (R6)
- PROPERTY(COMPATIBILITY-007): closeout still fully completes (no new hard-abort) when walkthrough succeeds, matching prior end-to-end behavior for the success case. (R7)
- PROPERTY(COMPATIBILITY-008): a clean, noise-free transcript's genuine-correction extraction output is byte-identical to pre-R8-fix output. (R8)
- PROPERTY(COMPATIBILITY-009): lanes with valid `testCommand` values proceed through setup and dispatch exactly as they did before R9 introduced validation (no new required fields, no changed dispatch order for the happy path). (R9)
- PROPERTY(COMPATIBILITY-010): lane branches with commits ahead of base, and lane branches whose worktree dirs DO still exist, are cleaned up identically to pre-R10 behavior. (R10)
- PROPERTY(COMPATIBILITY-011): no lane/phase not named in R1-R10 changes observable behavior, verified per-commit via `gitnexus_detect_changes()`. (R11)

---

## 2. Traceability Table

| Property ID | Category | Predicate (short) | Task ID(s) |
|---|---|---|---|
| SAFETY-001 | Safety | No raw TOMLDecodeError escapes | guard-duplicate-local-llm-toml |
| SAFETY-002 | Safety | No suffix-based false "allowed" | path-boundary-file-ownership |
| SAFETY-003 | Safety | No forced flat stub for docs-only/package tasks | relax-test-artifact-convention |
| SAFETY-004 | Safety | No adoption of unsafe/diverged branch | adopt-existing-feature-branch |
| SAFETY-005 | Safety | No silent epic_number=0 | recognize-bug-squash-branch-slug |
| SAFETY-006 | Safety | No corruption of lane-state path by fallback | git-fallback-retro-delivery |
| SAFETY-007 | Safety | No false checkmark on degraded walkthrough | fail-loud-walkthrough |
| SAFETY-008 | Safety | No high-confidence tag for noise-only match | filter-transcript-noise-memory-extract |
| SAFETY-009 | Safety | No dispatch on failed testCommand validation | validate-testcommand-before-dispatch |
| SAFETY-010 | Safety | No delete of branch with commits ahead | cleanup-orphaned-zero-commit-lane-branches |
| SAFETY-011 | Safety | No out-of-scope behavior change per commit | all 10 tasks |
| LIVENESS-001 | Liveness | Valid config always terminates in success/named-error | guard-duplicate-local-llm-toml |
| LIVENESS-002 | Liveness | Genuine violation always raised | path-boundary-file-ownership |
| LIVENESS-003 | Liveness | Every task shape resolves to a decision | relax-test-artifact-convention |
| LIVENESS-004 | Liveness | Safe branch always eventually adopted | adopt-existing-feature-branch |
| LIVENESS-005 | Liveness | Every branch name yields number-or-warning | recognize-bug-squash-branch-slug |
| LIVENESS-006 | Liveness | Fallback always yields non-0/0 given history | git-fallback-retro-delivery |
| LIVENESS-007 | Liveness | Closeout always completes despite degraded walkthrough | fail-loud-walkthrough |
| LIVENESS-008 | Liveness | Clean transcript still yields genuine candidate | filter-transcript-noise-memory-extract |
| LIVENESS-009 | Liveness | Valid testCommand always passes and dispatches | validate-testcommand-before-dispatch |
| LIVENESS-010 | Liveness | Every matching lane branch is enumerated | cleanup-orphaned-zero-commit-lane-branches |
| INVARIANT-001 | Invariant | Parsed dict shape stable pre/post fix | guard-duplicate-local-llm-toml |
| INVARIANT-002 | Invariant | Classification always boundary-based, never substring | path-boundary-file-ownership |
| INVARIANT-003 | Invariant | Stub decision is a total function | relax-test-artifact-convention |
| INVARIANT-004 | Invariant | Adopted state shape == manual-init state shape | adopt-existing-feature-branch |
| INVARIANT-005 | Invariant | Override always wins over regex | recognize-bug-squash-branch-slug |
| INVARIANT-006 | Invariant | Provenance label always accurate | git-fallback-retro-delivery |
| INVARIANT-007 | Invariant | Status indicator is pure function of content | fail-loud-walkthrough |
| INVARIANT-008 | Invariant | Confidence monotonic with noise classification | filter-transcript-noise-memory-extract |
| INVARIANT-009 | Invariant | Exit code exactly reflects runnability | validate-testcommand-before-dispatch |
| INVARIANT-010 | Invariant | Deletion-eligibility == commits_ahead==0 | cleanup-orphaned-zero-commit-lane-branches |
| INVARIANT-011 | Invariant | Every fix commit carries `Fixes #<N>` | all 10 tasks |
| BOUNDARY-001 | Boundary | 1 table OK, >1 table errors | guard-duplicate-local-llm-toml |
| BOUNDARY-002 | Boundary | Match boundary = path segment only | path-boundary-file-ownership |
| BOUNDARY-003 | Boundary | Convention field accepts 3 valid shapes only | relax-test-artifact-convention |
| BOUNDARY-004 | Boundary | Adoption requires all 3 conditions | adopt-existing-feature-branch |
| BOUNDARY-005 | Boundary | Regex recognizes exactly 2 slug shapes | recognize-bug-squash-branch-slug |
| BOUNDARY-006 | Boundary | Count bounded to epic-branch green(task-N) commits | git-fallback-retro-delivery |
| BOUNDARY-007 | Boundary | Degraded trigger = empty-fallback boundary | fail-loud-walkthrough |
| BOUNDARY-008 | Boundary | Noise classification boundary defined per shape | filter-transcript-noise-memory-extract |
| BOUNDARY-009 | Boundary | Runnable-against-sub-package boundary, not repo-root | validate-testcommand-before-dispatch |
| BOUNDARY-010 | Boundary | Zero-commits boundary exact, no off-by-one | cleanup-orphaned-zero-commit-lane-branches |
| IDEMPOTENT-001 | Idempotent | Repeat load same error | guard-duplicate-local-llm-toml |
| IDEMPOTENT-002 | Idempotent | Repeat call same result | path-boundary-file-ownership |
| IDEMPOTENT-003 | Idempotent | Repeat stub-gen no duplicate/clobber | relax-test-artifact-convention |
| IDEMPOTENT-004 | Idempotent | Repeat adopt no double-create | adopt-existing-feature-branch |
| IDEMPOTENT-005 | Idempotent | Repeat detect_context same outcome | recognize-bug-squash-branch-slug |
| IDEMPOTENT-006 | Idempotent | Repeat render same count/label | git-fallback-retro-delivery |
| IDEMPOTENT-007 | Idempotent | Repeat generate_walkthrough same indicator | fail-loud-walkthrough |
| IDEMPOTENT-008 | Idempotent | Repeat extraction same candidates | filter-transcript-noise-memory-extract |
| IDEMPOTENT-009 | Idempotent | Repeat validation same pass/fail | validate-testcommand-before-dispatch |
| IDEMPOTENT-010 | Idempotent | Repeat cleanup no re-processing error | cleanup-orphaned-zero-commit-lane-branches |
| ORDERING-001 | Ordering | Error surfaces before config consumption | guard-duplicate-local-llm-toml |
| ORDERING-002 | Ordering | Fix applies identically at RED and GREEN | path-boundary-file-ownership |
| ORDERING-003 | Ordering | Decision resolved before stub write | relax-test-artifact-convention |
| ORDERING-004 | Ordering | Safety checks precede state write | adopt-existing-feature-branch |
| ORDERING-005 | Ordering | Override evaluated before/short-circuits regex | recognize-bug-squash-branch-slug |
| ORDERING-006 | Ordering | Absence check precedes fallback invocation | git-fallback-retro-delivery |
| ORDERING-007 | Ordering | Decision made only after escalation resolves | fail-loud-walkthrough |
| ORDERING-008 | Ordering | Noise-filter runs before pattern match | filter-transcript-noise-memory-extract |
| ORDERING-009 | Ordering | Validation precedes worktree distribution | validate-testcommand-before-dispatch |
| ORDERING-010 | Ordering | Enumerate+compute before delete | cleanup-orphaned-zero-commit-lane-branches |
| ORDERING-011 | Ordering | R9 lane starts only after R4 lane merges | validate-testcommand-before-dispatch, adopt-existing-feature-branch |
| ISOLATION-001 | Isolation | One bad file doesn't affect other loads | guard-duplicate-local-llm-toml |
| ISOLATION-002 | Isolation | No cross-lane allowed/forbidden leakage | path-boundary-file-ownership |
| ISOLATION-003 | Isolation | Convention scoped to declaring task only | relax-test-artifact-convention |
| ISOLATION-004 | Isolation | No cross-epic state mutation | adopt-existing-feature-branch |
| ISOLATION-005 | Isolation | No cross-run epic_number leakage | recognize-bug-squash-branch-slug |
| ISOLATION-006 | Isolation | Fallback counts only own epic branch commits | git-fallback-retro-delivery |
| ISOLATION-007 | Isolation | Degraded indicator doesn't persist cross-run | fail-loud-walkthrough |
| ISOLATION-008 | Isolation | Noise decisions scoped per segment | filter-transcript-noise-memory-extract |
| ISOLATION-009 | Isolation | Validation scoped to own lane's sub-package | validate-testcommand-before-dispatch |
| ISOLATION-010 | Isolation | Cleanup scoped to own epic branch namespace | cleanup-orphaned-zero-commit-lane-branches |
| PERFORMANCE-001 | Performance | No added retry storm | guard-duplicate-local-llm-toml |
| PERFORMANCE-002 | Performance | Matching stays O(n·m) or better | path-boundary-file-ownership |
| PERFORMANCE-003 | Performance | Constant-factor overhead per task | relax-test-artifact-convention |
| PERFORMANCE-004 | Performance | Safety check same order as existing git-status | adopt-existing-feature-branch |
| PERFORMANCE-005 | Performance | Regex broadening adds negligible overhead | recognize-bug-squash-branch-slug |
| PERFORMANCE-006 | Performance | Scan bounded to epic branch range | git-fallback-retro-delivery |
| PERFORMANCE-007 | Performance | No extra LLM calls added | fail-loud-walkthrough |
| PERFORMANCE-008 | Performance | Linear-time noise filtering | filter-transcript-noise-memory-extract |
| PERFORMANCE-009 | Performance | Bounded timeout on validation | validate-testcommand-before-dispatch |
| PERFORMANCE-010 | Performance | Linear in run's lane-branch count | cleanup-orphaned-zero-commit-lane-branches |
| SECURITY-001 | Security | No secret leakage in error message | guard-duplicate-local-llm-toml |
| SECURITY-002 | Security | No path-traversal bypass of matching | path-boundary-file-ownership |
| SECURITY-003 | Security | No filesystem escape via glob convention | relax-test-artifact-convention |
| SECURITY-004 | Security | No cross-repo branch adoption | adopt-existing-feature-branch |
| SECURITY-005 | Security | Override validated as positive integer | recognize-bug-squash-branch-slug |
| SECURITY-006 | Security | Safe parsing of adversarial commit messages | git-fallback-retro-delivery |
| SECURITY-007 | Security | No internal error/secret leakage in indicator | fail-loud-walkthrough |
| SECURITY-008 | Security | Noise blobs dropped, not persisted | filter-transcript-noise-memory-extract |
| SECURITY-009 | Security | Validation execution stays within lane sandbox model | validate-testcommand-before-dispatch |
| SECURITY-010 | Security | Deletion scoped to own namespace only | cleanup-orphaned-zero-commit-lane-branches |
| OBSERVABILITY-001 | Observability | Error logged with file path | guard-duplicate-local-llm-toml |
| OBSERVABILITY-002 | Observability | Violation includes diagnostic detail | path-boundary-file-ownership |
| OBSERVABILITY-003 | Observability | Selected convention shape logged | relax-test-artifact-convention |
| OBSERVABILITY-004 | Observability | Adoption decision steps logged | adopt-existing-feature-branch |
| OBSERVABILITY-005 | Observability | Warning visible, names branch | recognize-bug-squash-branch-slug |
| OBSERVABILITY-006 | Observability | Provenance label visible in RETRO.md | git-fallback-retro-delivery |
| OBSERVABILITY-007 | Observability | Degraded indicator visible in CLI stream | fail-loud-walkthrough |
| OBSERVABILITY-008 | Observability | Noise-skip count loggable | filter-transcript-noise-memory-extract |
| OBSERVABILITY-009 | Observability | Failure reports lane + reason | validate-testcommand-before-dispatch |
| OBSERVABILITY-010 | Observability | Deleted branch + count logged | cleanup-orphaned-zero-commit-lane-branches |
| OBSERVABILITY-011 | Observability | gitnexus_detect_changes reviewed per commit | all 10 tasks |
| COMPATIBILITY-001 | Compatibility | Existing config files load unchanged | guard-duplicate-local-llm-toml |
| COMPATIBILITY-002 | Compatibility | Exact-match case unaffected | path-boundary-file-ownership |
| COMPATIBILITY-003 | Compatibility | Existing flat-extension task unchanged | relax-test-artifact-convention |
| COMPATIBILITY-004 | Compatibility | Default-branch/artifact-present case unaffected | adopt-existing-feature-branch |
| COMPATIBILITY-005 | Compatibility | epic-NNN detection unchanged | recognize-bug-squash-branch-slug |
| COMPATIBILITY-006 | Compatibility | Lane-state-present path byte-identical | git-fallback-retro-delivery |
| COMPATIBILITY-007 | Compatibility | Success-case completion unchanged | fail-loud-walkthrough |
| COMPATIBILITY-008 | Compatibility | Clean-transcript output unchanged | filter-transcript-noise-memory-extract |
| COMPATIBILITY-009 | Compatibility | Valid-testCommand happy path unchanged | validate-testcommand-before-dispatch |
| COMPATIBILITY-010 | Compatibility | Commits-ahead/worktree-present branches unaffected | cleanup-orphaned-zero-commit-lane-branches |
| COMPATIBILITY-011 | Compatibility | No behavior change outside named scope | all 10 tasks |

---

## 3. Per-Task Property Assignments

### guard-duplicate-local-llm-toml (R1, #265)
SAFETY-001, LIVENESS-001, INVARIANT-001, BOUNDARY-001, IDEMPOTENT-001, ORDERING-001, ISOLATION-001, PERFORMANCE-001, SECURITY-001, OBSERVABILITY-001, COMPATIBILITY-001

### path-boundary-file-ownership (R2, #269)
SAFETY-002, LIVENESS-002, INVARIANT-002, BOUNDARY-002, IDEMPOTENT-002, ORDERING-002, ISOLATION-002, PERFORMANCE-002, SECURITY-002, OBSERVABILITY-002, COMPATIBILITY-002

### relax-test-artifact-convention (R3, #270)
SAFETY-003, LIVENESS-003, INVARIANT-003, BOUNDARY-003, IDEMPOTENT-003, ORDERING-003, ISOLATION-003, PERFORMANCE-003, SECURITY-003, OBSERVABILITY-003, COMPATIBILITY-003

### adopt-existing-feature-branch (R4, #213)
SAFETY-004, LIVENESS-004, INVARIANT-004, BOUNDARY-004, IDEMPOTENT-004, ORDERING-004, ORDERING-011, ISOLATION-004, PERFORMANCE-004, SECURITY-004, OBSERVABILITY-004, COMPATIBILITY-004

### recognize-bug-squash-branch-slug (R5, #301)
SAFETY-005, LIVENESS-005, INVARIANT-005, BOUNDARY-005, IDEMPOTENT-005, ORDERING-005, ISOLATION-005, PERFORMANCE-005, SECURITY-005, OBSERVABILITY-005, COMPATIBILITY-005

### git-fallback-retro-delivery (R6, #302)
SAFETY-006, LIVENESS-006, INVARIANT-006, BOUNDARY-006, IDEMPOTENT-006, ORDERING-006, ISOLATION-006, PERFORMANCE-006, SECURITY-006, OBSERVABILITY-006, COMPATIBILITY-006

### fail-loud-walkthrough (R7, #303)
SAFETY-007, LIVENESS-007, INVARIANT-007, BOUNDARY-007, IDEMPOTENT-007, ORDERING-007, ISOLATION-007, PERFORMANCE-007, SECURITY-007, OBSERVABILITY-007, COMPATIBILITY-007

### filter-transcript-noise-memory-extract (R8, #304)
SAFETY-008, LIVENESS-008, INVARIANT-008, BOUNDARY-008, IDEMPOTENT-008, ORDERING-008, ISOLATION-008, PERFORMANCE-008, SECURITY-008, OBSERVABILITY-008, COMPATIBILITY-008

### validate-testcommand-before-dispatch (R9, #307; depends on adopt-existing-feature-branch)
SAFETY-009, LIVENESS-009, INVARIANT-009, BOUNDARY-009, IDEMPOTENT-009, ORDERING-009, ORDERING-011, ISOLATION-009, PERFORMANCE-009, SECURITY-009, OBSERVABILITY-009, COMPATIBILITY-009

### cleanup-orphaned-zero-commit-lane-branches (R10, #309)
SAFETY-010, LIVENESS-010, INVARIANT-010, BOUNDARY-010, IDEMPOTENT-010, ORDERING-010, ISOLATION-010, PERFORMANCE-010, SECURITY-010, OBSERVABILITY-010, COMPATIBILITY-010

### Cross-cutting (R11, applies to all 10 tasks)
SAFETY-011, INVARIANT-011, OBSERVABILITY-011, COMPATIBILITY-011

All 10 tasks have at least one property per applicable category — no task is flagged as
missing testable properties.
