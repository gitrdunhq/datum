# SPEC: Sequential repo-wide task numbers (DAT-NNN) instead of per-epic task-001

## Summary

Every epic today numbers its lanes `task-001`, `task-002`, ... starting over at zero, so the same id string names a different lane in every epic and downstream artifacts (issue titles, commit prefixes, branch names) carry no epic context. This change assigns each new epic's lanes a repo-wide monotonic id (`<PREFIX>-<n>`, e.g. `DAT-142`) at plan time, derived from a config-stored or auto-derived prefix and a counter computed from ids already committed to the repo, and widens every reader/validator to accept both the old `task-\d+`/`task-INT-\d+` shapes and the new `[A-Z]{2,6}-\d+` shape. Existing epics are untouched; this is a net-new-epics-only change with no migration.

## Context

The current id shape is hardcoded via `constr(pattern=r'^task-\d+$')` (or the widened `task-INT-\d+` variant) across at least 12 Pydantic schema files rooted at `datum/models/task_schema.py`, plus a string-prefix check `_INT_LANE_PREFIX = "task-INT-"` in `datum/gate.py` and id-emission code in `datum/integration_invariants.py` (`build_lane_plan`). The `plan-decompose.md` prompt (`skills/src/prompts/plan-decompose.md`) instructs the LLM to emit `task-NNN` ids and is explicitly out of scope for this change — the LLM keeps emitting `task-001`-style placeholder ids, and a new deterministic post-decompose step renumbers them to `<PREFIX>-<n>` before the plan gate runs. Everywhere else the id is consumed — `skills/src/shared/lane-steps.ts` (`PLAIN_ID_RE`), `skills/src/shared/utils.ts` (`laneCommitCommand`), marker file paths, worktree/branch names, `[task-NNN] title` issue titles, `Datum-Lane` trailers, and closeout collectors — treats the id as an opaque string and requires no code change, per the codebase scan. The `.datum/config.json` field `task_id_prefix` does not exist yet and is new config plumbing, following the existing read/derive/persist-once pattern already used for fields like `hooks_installed` and `agent_types`. `tests/test_lane_plan_schema_int_ids.py` already documents and tests a prior widening-only schema change (adding `task-INT-\d+` acceptance) and is the template for this change's schema tests.

## Requirements

1. **Prefix resolution reads or derives `task_id_prefix` from `.datum/config.json`.**
   - AC: When `.datum/config.json` has a `task_id_prefix` field, plan-time id assignment uses that value verbatim as the prefix.
   - AC: When the field is absent, the prefix is computed by taking the current repo directory's basename, removing every character that is not `[A-Za-z]`, upper-casing the result, and truncating to the first 3 characters (e.g. `datum` -> `DAT`).
   - AC: After deriving a prefix, `.datum/config.json` is rewritten with `task_id_prefix` set to the derived value before lane-plan output is written, so a second run in the same repo reads the persisted value instead of re-deriving it.
   - AC: When the derived prefix (after stripping non-letters and truncating) is fewer than 2 characters (e.g. a directory name of `9` or `_x`), plan-time id assignment fails with a structured error `{code: "task_id_prefix_invalid", message, correlationId}` rather than writing a 0- or 1-character prefix to config.

2. **A repo-wide counter computes `max(existing) + 1` over committed ids matching `<PREFIX>-\d+`.**
   - AC: The counter scans `id` and `depends_on` fields of every `docs/epics/*/tasks.json` file and every `lane-plan.json` file reachable via `git show HEAD:<path>` on the current branch (i.e., committed content, not working-tree edits), extracts every substring matching `^<PREFIX>-(\d+)$`, and the next assigned number is one greater than the highest `<n>` found.
   - AC: When no id matching `<PREFIX>-\d+` exists anywhere in the scanned committed files, the counter starts at 1 (first id is `<PREFIX>-1`).
   - AC: `task-\d+` and `task-INT-\d+` ids (the old shapes) are excluded from the `max(existing)` computation — only ids already in the new `<PREFIX>-\d+` shape count toward the counter.
   - AC: The counter scan is scoped to the current git branch's committed tree only; uncommitted working-tree changes and other local branches are not scanned, so two epics planned concurrently on separate branches can independently compute the same next number.

3. **A deterministic post-decompose renumbering step rewrites `task-NNN` ids to `<PREFIX>-<n>` in topological order.**
   - AC: `datum lane-plan --renumber`, invoked by the plan phase, runs immediately after the decomposer emits `tasks.json` with `task-001`-style ids and before the plan gate validates the epic.
   - AC: Renumbering visits lanes in dependency order (a lane's id is assigned only after all lanes it depends on already have their final ids assigned), so a lower `<PREFIX>-<n>` number never depends on a higher one for lanes in the same decompose batch.
   - AC: Every `depends_on` reference in `tasks.json` that points at a renumbered `task-NNN` id is rewritten to the corresponding `<PREFIX>-<n>` value; no `depends_on` entry references a stale `task-NNN` id after renumbering completes.
   - AC: Renumbering requires no interactive input and no operator step: the plan phase passes `--renumber` to `datum lane-plan` itself for a fresh epic (one with no committed lane-plan.json), and a bare `datum lane-plan` never renumbers, so an existing epic regenerates unchanged (Assumption 9, addendum 2026-09-07).

4. **Integration lanes synthesized by `build_lane_plan` take sequential `<PREFIX>-<n>` ids from the same counter, not the `task-INT-` shape.**
   - AC: For an epic planned after this change ships, every lane produced by `build_lane_plan`'s integration-lane synthesis has an id matching `<PREFIX>-\d+`, drawn from the same monotonic counter as regular task lanes (no `task-INT-` id is emitted for a new epic).
   - AC: Integration lanes are distinguished from task lanes solely via the existing `kind: integration` field on the lane record, not via an id-shape check.
   - AC: `tests/test_integration_invariants_frontier.py`, `tests/test_lane_plan_integration_lanes.py`, and `tests/test_lane_plan_schema_int_ids.py` continue to pass unmodified, verifying that epics already using `task-INT-\d+` ids remain valid.

5. **Every id-pattern check across TS and Python is widened to accept `task-\d+`, `task-INT-\d+`, and `[A-Z]{2,6}-\d+`, sourced from one shared, table-driven definition.**
   - AC: A single pattern definition lives in a shared location under `assets/schemas` (or equivalent single source of truth checked into the repo) and is consumed by both the Python Pydantic `constr` patterns (currently duplicated across the 12 files rooted at `datum/models/task_schema.py`) and the TypeScript regexes in `skills/src/shared/lane-steps.ts` and `datum/gate.py`'s `_INT_LANE_PREFIX`-adjacent checks.
   - AC: A unit test in both the Python suite and the TypeScript suite asserts that `task-1`, `task-INT-1`, and `DAT-142` all pass the shared pattern, and that `DAT142` (no hyphen), `dat-142` (lowercase), and `DATUM-142` (7-letter prefix) all fail it.
   - AC: No literal `task-\d+`-only or `task-INT-\d+`-only regex remains duplicated inline in `datum/models/*.py`, `datum/gate.py`, `skills/src/shared/lane-steps.ts`, `skills/src/triage-classify.ts`, `skills/src/datum-tdd-act-lane.ts`, or `datum/lane_plan.py` after this change — each references the shared pattern definition instead.

6. **The plan gate's `task_id_collision` check detects and reports two epics on different branches independently claiming the same `<PREFIX>-<n>` id.**
   - AC: When an epic branch is rebased or merged onto a base branch where a committed `tasks.json` or `lane-plan.json` already contains an identical `<PREFIX>-<n>` id assigned to a different lane, `datum lane-plan --validate` exits non-zero and reports a structured error containing the code `task_id_collision`, the colliding id, and the two conflicting lane/epic paths.
   - AC: When no id collision exists, `datum lane-plan --validate` run against the merged/rebased state produces no `task_id_collision` error.
   - AC: The `task_id_collision` failure does not silently pass through as a different error code or a generic validation failure — it is distinguishable in the gate's output/exit payload from other validation failures (e.g. schema-shape failures) by the `task_id_collision` code specifically.

7. **Every existing epic in `docs/epics/` continues to validate unchanged.**
   - AC: Running `datum lane-plan --validate` against every epic that exists in `docs/epics/` at the time this change ships exits 0 with no modification to any `tasks.json`, lane branch name, lane-state marker file, issue title, or commit already made.
   - AC: No code path in this change writes, renumbers, or migrates an existing `task-NNN` or `task-INT-N` id found in a committed epic.

8. **A fresh epic planned end-to-end produces `DAT-<n>`-shaped ids that propagate unchanged to branch name, commit prefix, marker file, and issue title.**
   - AC: A lane run for a lane with id `DAT-142` produces a git branch named `<epic>--DAT-142`, a worktree directory containing `DAT-142`, a lane-state marker file named `DAT-142.json` (or equivalent existing marker-naming convention with `DAT-142` substituted for the old id), commit subjects of the form `red(DAT-142): ...` / `green(DAT-142): ...` / `refactor(DAT-142): ...`, a `Datum-Lane: DAT-142` trailer, and (when the lane files an issue) an issue titled `[DAT-142] <lane title>`.
   - AC: A second epic planned in the same repo after the first receives ids continuing from the highest `<PREFIX>-<n>` committed by the first epic (e.g. if epic A ends at `DAT-150`, epic B's first lane is `DAT-151`).

## Failure Modes

| Failure | Handling |
|---|---|
| `.datum/config.json` has no `task_id_prefix` and the derived prefix is fewer than 2 letters | Fail plan-time id assignment with `{code: "task_id_prefix_invalid", message, correlationId}`; do not write an invalid prefix to config (Req 1) |
| Two epics planned concurrently on separate branches compute the same next `<PREFIX>-<n>` | Not prevented at plan time (no cross-branch state store); detected later by the `task_id_collision` gate check when one branch rebases/merges onto the other's base (Req 2, Req 6) |
| `depends_on` reference in `tasks.json` still points at a `task-NNN` id after renumbering | Renumbering step is required to rewrite every such reference in the same pass as the id it targets (Req 3); a leftover stale reference is a defect this change must not introduce |
| An existing `task-INT-\d+` id is present in a committed epic and a validator only recognizes `task-\d+` and `[A-Z]{2,6}-\d+` | The shared pattern must include `task-INT-\d+` explicitly so existing integration lanes keep validating (Req 5, Req 7) |
| Repo directory basename derives to a prefix that collides with letters already meaningful elsewhere (e.g. `AAA`) | Out of scope for automatic disambiguation; operator can set `task_id_prefix` explicitly in `.datum/config.json` to override (Req 1) |
| `datum lane-plan --validate` is run against an old epic and a validator was tightened instead of widened | Requirement 5's AC requires every changed pattern to be strictly widened (old shapes still pass) with a test asserting both old and new shapes pass |

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Counter computation reads only committed content on the current branch | No working-tree file writes are scanned; `git show HEAD:<path>` (or equivalent read-only git plumbing) is the sole read path for existing ids (Req 2) |
| Renumbering step adds no additional required CLI invocation | The plan phase alone (no separate manual step) runs decompose then `datum lane-plan --renumber` before the plan gate for a fresh epic; the flag is explicit so a re-run on an existing epic never renumbers (Req 3, addendum 2026-09-07) |
| Existing epic validation has zero regressions | 100% of epics present in `docs/epics/` at ship time pass `datum lane-plan --validate` with exit code 0 and zero file diffs (Req 7) |
| Shared pattern has exactly one source definition | Zero duplicated `task-\d+`/`task-INT-\d+`-only literal regexes remain in `datum/models/*.py`, `datum/gate.py`, `skills/src/shared/lane-steps.ts`, `skills/src/triage-classify.ts`, `skills/src/datum-tdd-act-lane.ts`, `datum/lane_plan.py` (Req 5) |

## Out of Scope

- Migrating any existing epic's `task-NNN` or `task-INT-N` ids to the new `<PREFIX>-<n>` shape — explicitly frozen per the ticket's scope decision.
- Rewriting any already-made commit, branch, lane-state marker, or filed issue title.
- Replacing branch-name-derived epic identity with a stable epic id (tracked separately per the ticket's "Related" note; this SPEC covers the task-id level only).
- A distributed/networked counter service or lock to prevent cross-branch id collisions before they happen — collisions are detected after the fact by the `task_id_collision` gate check, not prevented proactively.
- Any change to the `plan-decompose.md` prompt or the LLM's `task-NNN` emission behavior — the decomposer's output shape is explicitly unchanged; only the deterministic post-decompose step changes the ids.
- Configurable branch-naming, commit-prefix, or file-path templates — these continue to auto-derive from the id string with no new config surface beyond `task_id_prefix`.

## Open Questions

(none — ambiguity classified as low; residual gaps captured in `QUESTIONS.md` as confirmable-later items rather than blockers)

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | The renumbering step integrates as a deterministic post-decompose phase in `datum lane-plan` with no user intervention | Ticket states explicitly: "a deterministic step right after decompose ... rewrites tasks.json ids ... before the plan gate" | decided | n/a |
| 2 | All readers/validators update atomically in one change, with no phased migration | Ticket's scope decision is "Net-new epics only. No migration." — a phased rollout is explicitly rejected | decided | n/a |
| 3 | Prefix derivation (letters only, uppercase, first three chars) is deterministic and repo-scoped, computed once and persisted | Ticket specifies exact derivation rule (`datum` -> `DAT`) and "written back into the config so it never drifts" | confirmed | n/a |
| 4 | Branch naming, commit prefixes, marker file names, and issue titles all auto-derive from the task id string with no new config | Codebase scan confirms `PLAIN_ID_RE` and `laneCommitCommand` treat the id as an opaque string already; ticket states "Everywhere the id appears follows automatically because it is the same string" | confirmed | n/a |
| 5 | Existing `task-001` and `task-INT-N` identifiers remain frozen indefinitely; every reader accepts both shapes forever (not just during a transition window) | Ticket's scope decision: "Epics already planned keep their ... ids; every reader keeps accepting both shapes" with no stated sunset | decided | n/a |
| 6 | The `task_id_collision` gate check is a new check, not an extension of an existing named gate | Scan's `missing_symbols` confirms no `task_id_collision` symbol exists in the codebase today | confirmed | n/a |
| 7 | Integration lanes for new epics take ids from the identical counter/sequence as regular task lanes, distinguished only by the `kind` field | Ticket: "Integration lanes ... take the next numbers the same way (no task-INT- shape for new epics; kind: integration already says what they are)" | decided | n/a |

| 8 | `TASK` is an ordinary four-letter prefix like any other; the pattern does not carve it out, and the legacy malformed-id fixture case `TASK-001` in `tests/test_lane_plan_schema_int_ids.py` is updated by task-002 rather than encoded as an exclusion (addendum 2026-09-07) | The only reason to reject `TASK-001` was that the old per-epic scheme had no prefixes; under the new scheme it is a valid id, and a lookaround-free exclusion would be the Rust-regex contortion task-002's first GREEN produced | decided | Q1 |

| 9 | Renumbering is an explicit `--renumber` flag on `datum lane-plan`, passed by the plan phase only when the epic has no committed lane-plan.json; a bare `datum lane-plan` never renumbers, so existing epics regenerate unchanged (addendum 2026-09-07) | task-010's GREEN showed an unconditional renumber breaks every existing epic's regeneration path (`test_regenerating_lane_plan_keeps_each_lanes_github_issue`); the ticket named the explicit flag as one of two shapes | decided | Q2 |

## Classification Metadata

```yaml
estimated_files: 22
estimated_loc: 650
clusters_touched:
  - datum/models (pydantic schema patterns)
  - datum/gate.py (plan gate, task_id_collision check)
  - datum/lane_plan.py (validation, renumbering integration point)
  - datum/integration_invariants.py (build_lane_plan integration lane ids)
  - datum/cli.py (lane-plan CLI, --renumber / --validate flags)
  - skills/src/shared (lane-steps.ts pattern consumption)
  - assets/schemas (new shared laneIdPattern definition)
  - .datum/config.json (new task_id_prefix field)
new_public_api:
  - "datum lane-plan --renumber (CLI flag)"
  - "task_id_prefix (.datum/config.json field)"
  - "task_id_collision (plan gate error code)"
  - "laneIdPattern (shared TS/Python pattern module under assets/schemas)"
dependency_additions: []
```
