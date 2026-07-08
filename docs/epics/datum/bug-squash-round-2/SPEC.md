# SPEC: Bug Squash Round 2

## 1. Summary

Ten self-filed bugs left over from epic #282 (bug-squash-281) are fixed across the DATUM pipeline: a TOML config load crash, a false-positive file-ownership check, an over-rigid test-artifact convention, a missing branch-bootstrap path, two closeout parsing/reporting gaps, a silent LLM-escalation failure, noisy memory extraction, an unvalidated `testCommand`, and orphaned lane branches after a stopped run. Each fix is scoped, traceable to its GitHub issue via commit trailer, and delivered through the CLI path per AGENTS.md Core Directive #7 — no ad-hoc scripts.

## 2. Context

This epic operates entirely within the existing DATUM TDD-ACT pipeline (`datum-go` → `datum-plan` → `datum-tdd-act-setup` → `datum-tdd-act-lane` → `datum-tdd-act-merge` → `datum-closeout`) and its supporting Python CLI (`datum/cli.py` and modules under `datum/`).

- **Config loading** (`datum/local_llm.py:1499` `load_config()`, `:1628` `_load_raw_config()`) does a single `tomllib.load()` against one of an ordered list of `config.toml` paths (project `.datum/config.toml` → local `.datum/config.toml` → `assets/config.toml.default`), first-match-wins, no merge. The reported `TOMLDecodeError: Cannot declare ('local_llm',) twice` requires a malformed file with two `[local_llm]` headers; no current writer in the repo produces that shape, so the fix path is defensive parsing plus a regression fixture.
- **File ownership** (`skills/src/datum-tdd-act-lane.ts:53` `verifyFileOwnership`, called at RED L517 and GREEN L639) diffs `git diff --name-only HEAD~1 HEAD` against `allowedFiles`/`forbiddenFiles` using suffix/substring matching, which false-positives on paths like `Foo.test.ts` vs `NewFoo.test.ts`.
- **Test-artifact convention** (`datum/skeleton_creator.py:267-298`) infers a single file-extension per task to decide whether to stub a test file, which doesn't map onto compiled-language test-package layouts (e.g. Swift XCTest bundles, JVM test source sets).
- **Branch bootstrap** (`skills/src/datum-go.ts`, epicBranch/testCommand/lanePlanPath setup ~L156-269) has no path to adopt an already-checked-out feature branch as the epic branch; today it requires a manual `datum init` workaround, which is how this very epic was bootstrapped.
- **Closeout epic-number parsing** (`datum/closeout_cmd.py:26` `detect_context()`, regex at L39 `epic-(\d+)`) silently falls back to `epic_number=0` for any non-`epic-NNN` branch name, including this epic's own `bug-squash-306` branch.
- **Closeout RETRO.md Delivery section** (`datum/closeout/commit_closeout.py`) reports 0/0 with no fallback when `.datum/runs/<runId>/lane-state/` is missing.
- **Closeout walkthrough generation** (`skills/src/datum-closeout.ts`, `generate_walkthrough`) prints a success checkmark even when LLM escalation fails and the walkthrough silently degrades to empty.
- **Dream memory extraction** (`datum/memory_extract.py:36` `_extract_from_transcript`, called L104) uses `CORRECTION_PATTERNS` regexes (e.g. `\bdon.t\s+\w+`, `\balways\s+\w+`) tagged uniformly "high confidence" with no filter for transcript/tool-call noise.
- **Lane setup testCommand validation** (`skills/src/datum-tdd-act-setup.ts`, 77 lines, zero references to `testCommand`) never validates that `testCommand` is runnable against sub-package files before dispatching lanes, even though `testCommand` is established upstream (`datum-go.ts`/`datum-tdd-act.ts`) and consumed downstream (`datum-tdd-act-lane.ts` L113-161, 372, 583, 650, 718).
- **Worktree cleanup** (`datum/worktree_manager.py:208` `cleanup_run_worktrees()`, `:77` `remove_lane_worktree()`) only discovers lane branches via on-disk worktree directories under `.datum/worktrees/<run_id>/`; a branch created but whose worktree dir is missing/pruned is never found and is left orphaned with zero lane commits.

## 3. Requirements

### R1 — Fix duplicate `[local_llm]` TOML config crash (#265)
- AC1: `load_config()` and `_load_raw_config()` in `datum/local_llm.py` raise a clear, actionable error (not a raw `TOMLDecodeError`) when a `config.toml` contains a duplicate `[local_llm]` table, naming the offending file path.
- AC2: A regression test loads a fixture `config.toml` with two `[local_llm]` headers and asserts the improved error message/behavior (no unhandled traceback).
- AC3: Existing valid config files (`assets/config.toml.default`, `.datum/config.toml`, epic-26 bootstrap template) continue to load unchanged.

### R2 — Fix suffix-only matching in `verifyFileOwnership` (#269)
- AC1: `verifyFileOwnership` in `skills/src/datum-tdd-act-lane.ts` compares changed file paths against `allowedFiles`/`forbiddenFiles` using exact path equality or path-segment-boundary matching — not substring/suffix comparison.
- AC2: A case where a changed file's name is a suffix of an allowed file's name (e.g. `NewFoo.test.ts` changed, `Foo.test.ts` allowed) does NOT raise `file_ownership_violation`.
- AC3: A case where the changed file is genuinely outside `allowedFiles` still raises `file_ownership_violation`.
- AC4: Fix is made in `skills/src/datum-tdd-act-lane.ts` and propagated to `skills/datum-tdd-act-lane.js` via `bash scripts/build-workflows.sh` — the generated `.js` is never hand-edited.

### R3 — Relax test-artifact extension convention for compiled-language/docs-only epics (#270)
- AC1: `skeleton_creator.py`'s extension-matching logic (L267-298) supports a task declaring a test-package/directory convention (e.g. a directory path or glob) in addition to a single flat file extension, without breaking existing single-file-extension tasks.
- AC2: A docs-only epic task (no source-code test file expected) does not force a flat-extension test-file stub to be generated.
- AC3: A regression test covers at least one compiled-language-style test declaration (e.g. a test-package directory) alongside the existing flat-extension case, asserting correct stub-generation behavior for each.

### R4 — Support bootstrapping an epic from an existing feature branch (#213)
- AC1: `datum-go.ts`'s epic-branch bootstrap step detects when the current branch is already a non-default branch with no existing `TICKET.md`/lane-plan artifacts, and offers an "adopt this branch as the epic branch" path instead of requiring a separate `datum init`.
- AC2: The adopt path is exposed via the CLI (`datum init` or equivalent existing subcommand), not an inline script — per AGENTS.md Core Directive #7.
- AC3: Adopting an existing branch produces the same `epicBranch`/`lanePlanPath` state shape downstream phases (plan/act/setup/lane/merge/closeout) already expect, verified by a workflow-level test/dry-run.
- AC4: If the current branch has diverged from `main`/base such that adoption is unsafe (e.g. uncommitted conflicting state), the CLI fails with a clear error rather than silently proceeding.

### R5 — Recognize non-`epic-NNN` branch slugs in closeout (#301)
- AC1: `detect_context()` in `datum/closeout_cmd.py` (L39 regex) recognizes at minimum `epic-(\d+)` and `bug-squash-(\d+)` branch naming patterns.
- AC2: An explicit `--epic-number` CLI override, if supplied, always takes precedence over regex-inferred detection.
- AC3: A branch matching neither known pattern and with no explicit override produces a clear warning (not a silent `epic_number=0`).
- AC4: Regression tests in `tests/test_closeout_cmd.py` cover `epic-NNN`, `bug-squash-NNN`, and an unrecognized-slug branch name.

### R6 — Git-based fallback for RETRO.md Delivery section (#302)
- AC1: When `.datum/runs/<runId>/lane-state/` is absent, `datum closeout`'s Delivery-section generation derives delivered/total task counts from git log (e.g. commits matching the repo's `green(task-N)`-style trailers) on the epic branch.
- AC2: The RETRO.md output clearly labels the fallback-derived numbers as git-derived (vs. lane-state-derived) so readers know the provenance.
- AC3: When lane-state IS present, existing behavior is unchanged (no regression to the primary path).
- AC4: A regression test simulates a missing lane-state directory and asserts a non-0/0 Delivery count is produced from git history.

### R7 — Fail loud on walkthrough generation failure (#303)
- AC1: `generate_walkthrough` in `skills/src/datum-closeout.ts` only prints a success checkmark when the walkthrough content was actually produced by the LLM (not the empty fallback).
- AC2: On LLM escalation failure, the CLI output shows a clear failure/degraded-mode indicator instead of a false checkmark.
- AC3: Fix is made in the TS source and rebuilt via `bash scripts/build-workflows.sh`.

### R8 — Filter transcript/tool-call noise from memory extraction (#304)
- AC1: `_extract_from_transcript` in `datum/memory_extract.py` skips or downgrades confidence for matches whose surrounding text looks like tool-call/transcript noise (e.g. JSON tool_use/tool_result blobs, raw code blocks, file-path-only lines) before applying `CORRECTION_PATTERNS`.
- AC2: A regression test feeds a transcript containing both a genuine correction statement and tool-call noise, and asserts only the genuine statement surfaces as a high-confidence candidate.
- AC3: Existing genuine-correction extraction behavior (non-noise transcripts) is unchanged.

### R9 — Validate `testCommand` against sub-package files before lane dispatch (#307)
- AC1: `skills/src/datum-tdd-act-setup.ts` (or a new/extended `datum` CLI subcommand it calls, per the CLI-first pattern) validates that the lane's `testCommand` is runnable against the sub-package files it targets before batching lanes out to worktrees.
- AC2: An invalid/non-runnable `testCommand` produces a clear, actionable error identifying the lane and the failure reason, and setup halts before worktree distribution (hard-fail — see Assumption A6).
- AC3: A valid `testCommand` proceeds through setup unchanged from current behavior.
- AC4: Fix is made in TS source and rebuilt via `bash scripts/build-workflows.sh`; any new validation logic is added as a `datum` CLI subcommand invocation, not inline TS shell logic, per AGENTS.md Core Directive #7.

### R10 — Delete orphaned zero-commit lane branches on worktree cleanup (#309)
- AC1: `cleanup_run_worktrees()` in `datum/worktree_manager.py` additionally enumerates lane branches via `git for-each-ref refs/heads/<epic_branch>--*` (not just on-disk worktree directories).
- AC2: Any discovered lane branch with zero commits ahead of its epic/base branch is deleted, whether or not its worktree directory still exists on disk.
- AC3: Lane branches WITH commits ahead of base are left untouched even if their worktree directory is missing.
- AC4: A regression test simulates a lane branch with no corresponding worktree directory and zero commits, and asserts it is deleted by cleanup.

### R11 — Traceability and process compliance (cross-cutting)
- AC1: Every commit made for a fix in R1-R10 includes a commit trailer referencing its GitHub issue in the form `Fixes #<N>` (see Assumption A4).
- AC2: All fixes are delivered via `datum <command>` CLI invocations in workflow scripts, not ad-hoc standalone scripts.
- AC3: `gitnexus_detect_changes()` (or equivalent affected-scope check) run before each commit shows changes scoped only to the named symbols/files for that bug — no incidental behavior change to lanes/phases not named in the ticket.

## 4. Failure Modes

| Failure Mode | Handling |
|---|---|
| Duplicate `[local_llm]` TOML table still crashes with unclear error after fix | R1 AC1 requires a named, actionable error message; regression test (R1 AC2) guards against silent regression |
| `verifyFileOwnership` fix introduces new false negatives (real violations missed) | R2 AC3 requires a positive-case regression test alongside the negative-case fix |
| Test-artifact convention change breaks existing flat-extension epics | R3 AC1 requires the extension-matching change to be additive, not replacing, existing single-file-extension behavior; R3 AC3 covers both cases |
| Branch-adoption path (#213) adopts a branch with unsafe/conflicting state | R4 AC4 requires a hard failure with clear error instead of silent proceed |
| Closeout regex broadening (#301) matches unintended branch names too eagerly | R5 AC3/AC4 require explicit test coverage of at least one unrecognized-slug case that must NOT silently succeed |
| Git-based Delivery fallback (#302) produces misleading exact-looking numbers | R6 AC2 requires explicit provenance labeling in RETRO.md output |
| Walkthrough fix (#303) causes closeout to hard-fail entirely instead of degrading | R7 AC2 specifies a "degraded-mode indicator," not necessarily a pipeline-halting failure — closeout should still complete, just without a false success signal |
| Noise filter (#304) over-filters and drops genuine correction candidates | R8 AC2/AC3 require both noise-rejection and genuine-signal-preservation test coverage |
| `testCommand` validation (#307) blocks valid-but-unusually-configured lanes | R9 AC2 requires the error to be actionable so a false-positive block can be diagnosed and the check adjusted |
| Worktree branch cleanup (#309) deletes a branch that has unpushed but real commits | R10 AC3 explicitly protects branches with commits ahead of base, regardless of worktree-dir presence |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Backward compatibility | No behavior change to lanes/phases not named in the ticket (verified via `gitnexus_detect_changes()` per fix, R11 AC3) |
| Build discipline | All `skills/src/*.ts` changes rebuilt via `bash scripts/build-workflows.sh` before commit; generated `.js` never hand-edited |
| CLI-first dispatch | All new validation/logic exposed through `datum <command>` CLI subcommands, not inline scripts (AGENTS.md Core Directive #7) |
| Traceability | 100% of fix commits carry a `Fixes #<N>` trailer matching the ticket's issue list |
| Regression coverage | Each of R1-R10 has at least one new automated test (pytest for Python modules, existing TS test runner for workflow scripts) that fails before the fix and passes after |
| Isolation | Each bug fix is independently committable/revertible; no fix depends on another being merged first (Assumption A3) |

## 6. Out of Scope

- #134, #259, #260, #264 — larger feature epics requiring dedicated planning, not part of this bugfix lane.
- #275, #276 — tied to a downstream repo's (the-record-suite) specific run context; not reproducible generically in this repo.
- Any refactor or behavior change to lanes/phases not explicitly named in the ten bugs above.
- New test infrastructure/frameworks beyond what's already used per-language in this repo (pytest for Python, existing TS test runner for workflow scripts).

## 7. Open Questions

None — ambiguity classification for this ticket is low. Gaps identified during scoping (lane organization, per-bug testing/validation approach, commit trailer exact format, execution order, #270/#307 scope details) are captured with proposed resolutions in the Assumption Audit below and mirrored in `QUESTIONS.md` for explicit confirmation before lane dispatch.

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| A1 | Each of the 10 bugs is implemented as its own lane (one lane per issue) | Bugs touch disjoint files/symbols (local_llm.py, datum-tdd-act-lane.ts, skeleton_creator.py, datum-go.ts, closeout_cmd.py, commit_closeout.py, datum-closeout.ts, memory_extract.py, datum-tdd-act-setup.ts, worktree_manager.py) with no shared edit surface, so one-lane-per-bug maximizes parallelism and minimizes merge conflicts | decided | n/a |
| A2 | Regression tests are the verification mechanism for "no behavior change to lanes/phases not named above" | Repo convention (pytest for Python, TS test runner for workflow scripts) already gates merges; scan confirms existing test files per touched module (test_closeout_cmd.py, test_epic26_config_overlay.py) | decided | n/a |
| A3 | The 10 bugs are independently fixable with no inter-dependencies, so execution order is not load-bearing | Scan shows disjoint files/symbols across all 10 items with zero cross-references between the fix points | confirmed | n/a |
| A4 | Commit trailer format is `Fixes #<N>` (standard GitHub auto-close convention) | Standard git/GitHub convention; repo already has precedent for inline issue references (skeleton_creator.py comments citing #235/#231, worktree_manager.py citing #137) | decided | n/a |
| A5 | #270's "compiled languages" scope is interpreted broadly as any test convention that maps to a directory/package rather than a single file extension (not an exhaustive per-language enumeration) | Ticket text is generic ("compiled languages") without naming specific languages; scan found no existing per-language enumeration in skeleton_creator.py to anchor a narrower interpretation | guess | n/a |
| A6 | #307's testCommand validation is hard-fail (blocks dispatch) rather than soft-warn | Ticket's intent ("does not detect or validate... before dispatching") implies dispatch currently proceeds unsafely; hard-fail prevents wasted lane-worktree churn on a broken testCommand, consistent with DPS-200/fail-fast conventions | guess | n/a |
| A7 | Each GitHub issue (#265, #269, etc.) contains sufficient additional context beyond the ticket text to fully scope implementation detail during lane execution | Standard practice for self-filed bugs in this repo; ticket references issues by number as the source of truth | decided | n/a |
| A8 | No new test infrastructure is required — existing pytest/TS test runner conventions are extended, not replaced | Scan's test_framework/test_conventions fields confirm established per-language test patterns already in place | confirmed | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 14
estimated_loc: 650
clusters_touched:
  - local_llm_config
  - tdd_act_lane_workflow
  - skeleton_creator
  - datum_go_bootstrap
  - closeout_pipeline
  - memory_extract_dream
  - tdd_act_setup_workflow
  - worktree_manager
new_public_api:
  - "datum closeout --epic-number override (explicit CLI flag, if not already present)"
  - "datum testCommand validation subcommand (new or extended, invoked from datum-tdd-act-setup.ts)"
dependency_additions: []
```
