# SPEC: Integration Lanes — Cross-Task Invariants as RED-Only Lanes at the Merge Frontier

## 1. Summary

Today the Act pipeline verifies each task lane in isolation (RED, GREEN, skeptic, REFACTOR) and nothing checks that merged lanes hold the epic's cross-task invariants together — this let integration defects escape to Review in three recent consumer epics (eedom #521/#562/#566, elonChesd epic-1/playable-ui-shell). This slice makes the Properties phase emit tagged cross-task invariants (one per answered QUESTIONS.md item plus any spec-derived cross-task rule), and makes the Plan phase schedule a synthetic `task-INT-<n>` lane per merge frontier whose RED writes those invariants as tests against the already-merged dependency tree. An INT lane is RED-only — there is no GREEN in this slice — so a failing INT test is filed as a real integration defect and triaged to the covered tasks, never to the INT lane itself.

## 2. Context

The pipeline's Properties phase currently emits `PROPERTIES.md` through an LLM-driven skill step (`datum-properties`), validated post-hoc by `gate_properties` (`datum/gate.py:1147-1192`), which checks for 11 required category keywords and a traceability table but has no per-question invariant requirement today. `QUESTIONS.md`'s answered-question shape (`### Q<N>:` heading + non-empty `[Answer]:` line) is already parsed by `check_questions_answered` (`datum/gate.py:133-179`); this slice reuses that exact regex rather than reinventing it.

Lane construction happens in `build_lane_plan` (`datum/lane_plan.py:538-624`), which today emits one lane per `tasks.json` entry and already threads an optional `kind` field (`structural`/`behavioral`, from issue #369) unchanged through `lane_plan_digest._LANE_FIELDS` (`datum/lane_plan_digest.py`) and `export_lane_spec`'s `**lane` spread (`datum/lane_spec_export.py:143-182`). This slice extends that same threading pattern for `kind: "integration"` and a new `expect_tests_pass` flag, so no digest or export code changes — only the lane object gains new keys at construction time.

Lane-plan schema validation is enforced by the pydantic models in `datum/models/lane_plan_schema.py`, referenced from `datum/contracts.py`'s `SCHEMA_MAP` (there is no literal `assets/schemas/lane-plan.schema.json` file — the name is a virtual key resolved to the pydantic class). `Lanes.id`, `TopologicalOrderItem.root`, and `DatumLanePlan.file_ownership` keys all currently use `constr(pattern=r'^task-\d+$')`, which will reject `task-INT-<n>` ids unless the pattern is widened.

`gate_plan` (`datum/gate.py:905-1037`) validates schema, zero-lane state, per-lane fields, `depends_on` referential integrity, file-overlap-vs-dependency, and an assumption-audit gate; it needs new checks for unknown covered tasks, the zero-invariant warning, and INT-lane `depends_on` correctness. `check_zero_lanes` (`datum/gate.py:893-902`) hard-fails only when *all* lanes are empty, so a zero-INT-lane plan with normal task lanes is unaffected — R8's warning is additive.

`run_batch`/`run_preflight` in `datum/skeleton_creator.py:751-853` already iterate every lane in a lane-plan-shaped structure and derive skeleton test functions from `acceptance_criteria` via `_extract_signatures_from_acs`/`make_function_name` (`datum/skeleton_creator.py:442`) — this generic path likely produces one skeleton per AC for an INT lane with no change except naming skeletons from the invariant ID rather than a generated slug.

No Python module authors a single epic's `PROPERTIES.md` directly — it is produced by an LLM/prompt-driven skill step, so R2's "properties-derive prompt" change is a prompt-template edit (in `skills/` or `.claude/skills/datum-properties/`), not new Python.

## 3. Requirements

### R1 — PROPERTIES.md gains an `## Integration Invariants` table

- **AC1.1**: `PROPERTIES.md` produced by the properties-derive step contains a section headed `## Integration Invariants` with a markdown table with columns `ID | Invariant | Covers | Source`, in that order.
- **AC1.2**: Each row's `Covers` column is a comma-separated list of task ids that all exist in `tasks.json`; the list has ≥2 entries unless `Source` is `question:Q<N>`, in which case 1 entry is permitted.
- **AC1.3**: Each row's `Source` column matches either `spec:<section>` (an existing SPEC.md section name/anchor) or `question:Q<N>` (an existing answered question id).
- **AC1.4**: A `PROPERTIES.md` missing the `## Integration Invariants` heading, or with malformed rows (wrong column count, `Covers` referencing an unknown task id, `Source` matching neither pattern), fails `gate_properties` with a structured error.

### R2 — One invariant per answered question

- **AC2.1**: For every question block in `QUESTIONS.md` matching `### Q<N>:` followed by a non-empty `[Answer]:` line (per the existing `check_questions_answered` regex), `PROPERTIES.md`'s Integration Invariants table contains exactly one row with `Source` = `question:Q<N>`.
- **AC2.2**: That row's `Invariant` text states the answer as a checkable, testable expectation (not a restatement of the question).
- **AC2.3**: A question with an empty `[Answer]:` (or none) yields zero rows in the table.
- **AC2.4**: The properties-derive prompt template is updated to explicitly instruct: "emit one Integration Invariant per answered question in QUESTIONS.md, with Source `question:Q<N>`".
- **AC2.5**: `datum gate properties` fails with error code `invariant_missing_for_question: Q<N>` when an answered question `Q<N>` has no corresponding Integration Invariant row, and passes when every answered question has exactly one.

### R3 — `datum lane-plan` schedules synthetic `task-INT-<n>` lanes at merge frontiers

- **AC3.1**: `build_lane_plan` (or a new helper it calls) reads Integration Invariants from `PROPERTIES.md`, groups them by the sorted tuple of their `Covers` task ids (a "merge frontier" = the set of invariants whose covered tasks are exactly a given tuple, all of which are present in `tasks.json`), and emits one lane per group.
- **AC3.2**: Groups are ordered by `n` starting at 1, assigned in topological order of the group's covered-task tuple (a group whose covered tasks are all ancestors of another group's covered tasks sorts first; ties broken by ascending covered-task-id order for determinism).
- **AC3.3**: Each synthetic lane has `id: "task-INT-<n>"`, `kind: "integration"`, `depends_on` equal to the sorted list of the group's covered task ids, `files` equal to exactly one new test file path (`tests/integration/test_int_<n>.py` when the epic's `test_command` targets pytest; `src/integration/int-<n>.test.ts` when it targets a TypeScript/JS runner), and `acceptance_criteria` equal to the group's invariant texts (one AC string per invariant, in table order).
- **AC3.4**: An Integration Invariant whose `Covers` includes a task id absent from `tasks.json` causes `datum gate plan` to fail with `invariant_covers_unknown_task: <ID> -> <task>` (one message per offending covers-entry).
- **AC3.5**: `datum/models/lane_plan_schema.py`'s id-pattern constraints (`Lanes.id`, `TopologicalOrderItem.root`, `DatumLanePlan.file_ownership` keys) are widened (e.g. to `^task-(\d+|INT-\d+)$`) so a plan containing INT lanes passes schema validation; a plan with only task lanes continues to validate exactly as before.

### R4 — `kind` and `expect_tests_pass` carry through digest and export unchanged

- **AC4.1**: `datum lane-plan-digest`'s output includes `kind` for every lane (already true via existing `_LANE_FIELDS`); a plan written before this slice (no `kind` key on any lane) digests every lane as `kind: "task"`.
- **AC4.2**: `datum lane-spec-export`'s per-lane export includes `kind` and, for integration lanes, `expect_tests_pass: true`, via the existing `**lane` spread with no code change to `export_lane_spec` beyond ensuring `build_lane_plan` writes these keys onto INT lane dicts.
- **AC4.3**: The exported spec for a task lane (kind absent or `"task"`) does not include `expect_tests_pass`.

### R5 — Integration lane `contract_summary` states tests must pass, not fail

- **AC5.1**: For an integration lane, the exported lane spec's `contract_summary` includes a sentence stating the lane's tests are expected to PASS against the existing merged code and must not be written to fail.
- **AC5.2**: This text is produced without changing `contract_summary()`'s signature — either by injecting a fixed integration-specific sentence when `kind == "integration"` before/after the existing `contract_summary()` call, or by prepending it to the lane's `acceptance_criteria` at construction time so it flows through unchanged code.
- **AC5.3**: A task lane's `contract_summary` output is byte-identical to its current (pre-slice) output.

### R6 — `datum skeleton --batch` creates INT skeleton files named from invariant IDs

- **AC6.1**: For each `task-INT-<n>` lane, `run_batch`/`run_preflight` create the lane's designated test file (per R3's path rule) containing one skeleton test per acceptance criterion (i.e. per invariant), in the same placeholder shape (`pytest.fail("not implemented")` / `test.skip`/equivalent per language) that task-lane skeletons already use.
- **AC6.2**: Each skeleton test function is named from its invariant's `ID` column value (e.g. invariant `II3` → `test_ii3` in Python, `II3` test name in TS), not from a generated slug of the invariant text — `make_function_name` (`datum/skeleton_creator.py:442`) is extended to accept and prefer an explicit id token when the AC is sourced from an invariant.
- **AC6.3**: Skeleton generation for task lanes is unaffected — function naming for non-integration ACs is unchanged.

### R7 — `ac_count` equals invariant count for INT lanes

- **AC7.1**: The exported lane spec's `ac_count` for an integration lane equals `len(acceptance_criteria)`, which equals the number of invariants in its group — this is the existing `ac_count` computation applied unchanged to the INT lane's `acceptance_criteria` list.
- **AC7.2**: The existing count gate (whatever currently enforces "one test function per AC") requires exactly one new test function per invariant in the INT lane's skeleton file, with zero changes to the gate's logic.

### R8 — Zero invariants means zero INT lanes, with a warning not a failure

- **AC8.1**: A `PROPERTIES.md` with an empty (or absent, if AC1.4's gate is satisfied by an empty-but-present section) `## Integration Invariants` table produces a lane plan with zero `task-INT-*` lanes and all task lanes unchanged from current behavior.
- **AC8.2**: `datum gate plan` in this case writes `no_integration_invariants` to stderr and exits 0 (does not fail the gate), distinguishing this from `check_zero_lanes`'s existing all-lanes-empty hard failure, which still fires only when there are zero lanes of any kind.

### R9 — `gate plan` verifies INT-lane `depends_on` integrity and direction

- **AC9.1**: `datum gate plan` fails if any `task-INT-<n>` lane's `depends_on` (as a set) is not exactly equal to the union of its invariants' `Covers` task ids.
- **AC9.2**: `datum gate plan` fails if any non-integration (`kind` absent or `"task"`) lane's `depends_on` includes a `task-INT-*` id.

### R10 — Documentation

- **AC10.1**: `docs/FLOW.md` gains a new section describing integration lanes: RED-only (no GREEN in this slice), scheduled at merge frontiers, and failure routing to covered tasks (not the INT lane).
- **AC10.2**: `SKILL.md` documents `kind: "integration"` as a lane kind and both new gate error/warning names (`invariant_missing_for_question`, `invariant_covers_unknown_task`, `no_integration_invariants`) plus `integration_failed` as the slice-2 triage-facing name reserved for later.

## 4. Failure Modes

| Failure | Handling |
|---|---|
| Answered question has no matching Integration Invariant row | `gate_properties` fails with `invariant_missing_for_question: Q<N>` (AC2.5) |
| Integration Invariant's `Covers` references a task id not in `tasks.json` | `gate_plan` fails with `invariant_covers_unknown_task: <ID> -> <task>` (AC3.4) |
| `PROPERTIES.md` missing `## Integration Invariants` heading or has malformed rows | `gate_properties` fails with a structured parse error (AC1.4) |
| Zero Integration Invariants exist | `gate_plan` warns `no_integration_invariants` on stderr, exits 0; zero INT lanes scheduled (R8) |
| INT lane's `depends_on` doesn't match union of covered tasks | `gate_plan` fails (AC9.1) |
| A task lane depends on an INT lane | `gate_plan` fails (AC9.2) — INT lanes must never gate task lane scheduling |
| `task-INT-<n>` id fails lane-plan schema pydantic validation | Fixed by widening `constr` patterns in `lane_plan_schema.py` (AC3.5); until fixed, every plan containing an INT lane hard-fails schema_errors |
| INT lane's RED tests fail against the merged tree (an actual integration defect) | Filed and triaged to the covered tasks, never to the INT lane itself (ticket "Not This" — full triage/routing logic is slice 2) |
| Overlapping/conflicting dependency graphs among a group's covered tasks complicate topological ordering of `task-INT-<n>` groups | Deterministic tie-break: ascending covered-task-id order (AC3.2) — flagged in Open Questions for confirmation |
| Two merge-frontier groups end up with an identical covered-task tuple from different invariant subsets | Not possible by construction — grouping key is the covered-task tuple itself, so all invariants sharing a tuple merge into one group/one lane |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Backward compatibility | Lane plans written before this slice (no `kind` field on any lane) must digest and export identically to current behavior — zero regression in `_LANE_FIELDS` output or `contract_summary` for task lanes |
| Determinism | Given the same `PROPERTIES.md` and `tasks.json`, `task-INT-<n>` numbering and grouping must be identical across repeated runs (no reliance on dict/set iteration order without an explicit sort) |
| No TypeScript changes | This slice is Python-only in `datum/`; the RED-only lane-runner branch, vitest integration, and triage routing described in the ticket's "Not This" are slice 2 |
| Gate performance | New `gate_properties`/`gate_plan` checks must not add more than a single additional linear pass over `PROPERTIES.md`/`tasks.json` per invocation (no repeated re-parsing) |
| Schema safety | Widening the `task-INT-<n>` id pattern in `lane_plan_schema.py` must not loosen validation for ordinary `task-<n>` ids (existing task-id-only plans must fail exactly as before on malformed ids) |

## 6. Out of Scope

- The lane runner's integration branch (RED-only: intake, RED, post-RED gates, independent test-verify, then stop; `integration_failed: <IDs> — <first failing test>` on a red suite; a new `integration` triage category routed to covered tasks) — slice 2, its own epic, `test_command` set to vitest.
- Until slice 2 lands, an INT lane runs the full existing task path (RED, GREEN, skeptic, REFACTOR); its GREEN is expected to find nothing to implement since the code is already merged.
- Automatic fix lanes for integration failures; re-opening covered tasks is a later slice.
- Skeptic dependency closure (#445).
- Regression-test-per-fixed-skeptic-finding gate (#448).
- Random-walk invariants (#446).
- Seam gate (#447).
- Playwright gate (#457).
- Any change to how existing task lanes run.
- New agent types — INT lanes use the existing `datum-red` agent with an integration-specific prompt variant.
- An epic-level `task-INT-all` lane; this slice schedules frontier lanes only.

## 7. Open Questions

See `QUESTIONS.md` for the following gaps requiring human/operator decisions before implementation:

- Precise merge-frontier detection semantics and scheduling order relative to task-lane completion.
- Exact properties-derive prompt wording/structure for the per-question invariant instruction.
- Whether `tests/integration/` and `src/integration/` are pre-existing or must be created on demand by the lane-plan/skeleton step.
- Confirmation of the existing task-skeleton placeholder shape to replicate for INT lanes.
- Determinism rule for topological ordering when covered-task dependency graphs overlap or conflict across groups.
- File-location policy for languages other than Python/TypeScript, if any are in scope for this repo's lane plans.

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | Readers are familiar with datum's lane/phase architecture (RED, GREEN, skeptic, REFACTOR, Act machinery) | Established in `docs/FLOW.md` and existing `datum-tdd-act*` skills; not re-derived here | confirmed | n/a |
| 2 | `QUESTIONS.md` answered-question shape is `### Q<N>:` + non-empty `[Answer]:`, matching `check_questions_answered`'s regex | Verified in `datum/gate.py:133-179` | confirmed | n/a |
| 3 | `tasks.json` is authoritative for task ids and dependency ordering | Verified via `build_lane_plan` (`datum/lane_plan.py:538-624`) and `assets/schemas/task.schema.json` | confirmed | n/a |
| 4 | The properties-derive prompt is an LLM/skill-template artifact, not Python, and can be edited to add the per-question invariant instruction | No Python module authors a single epic's `PROPERTIES.md`; scan found only the cross-epic aggregator `datum/analyze_properties.py`, a different feature | guess | Q1 (properties-derive prompt spec) |
| 5 | `task-INT-<n>` ids must pass through `lane_plan_schema.py`'s `constr` patterns, requiring a regex widening | Verified: `Lanes.id`/`TopologicalOrderItem.root`/`DatumLanePlan.file_ownership` all use `^task-\d+$` today | confirmed | n/a |
| 6 | "Merge frontier" = the set of invariants whose `Covers` tasks are all present in `tasks.json`, grouped by the sorted covered-task tuple, with no dependency on task-lane completion timing at plan-build time | Ticket text is explicit on the grouping key but silent on completion-timing semantics ("scheduled at their merge frontier") | decided | Q2 (merge frontier / scheduling timing) |
| 7 | Topological ordering of `task-INT-<n>` groups ties-break on ascending covered-task-id order when dependency graphs overlap | Not specified by the ticket; needed for deterministic numbering | guess | Q6 (topological ordering collision) |
| 8 | Integration test directories (`tests/integration/`, `src/integration/`) are created on demand by the skeleton/lane-plan step if absent, mirroring how task skeleton directories are handled today | Ticket specifies paths but not creation semantics; scan found no explicit auto-mkdir behavior documented for existing skeleton creation | guess | Q3 (directory auto-creation) |
| 9 | INT-lane skeletons reuse the exact placeholder shape (`pytest.fail`/equivalent) that `run_batch`/`_extract_signatures_from_acs` already produce for task lanes, with only the function-naming step changed | Verified generic iteration in `datum/skeleton_creator.py:751-853`, but exact placeholder body text not independently re-verified in this pass | guess | Q4 (skeleton shape reference) |
| 10 | Existing triage machinery can, in slice 2, route a single integration failure to multiple covered tasks without new plumbing beyond a new `integration` category | Ticket's "Not This" section describes this as existing/deferred, not detailed here | guess | Q5 (integration failure triage routing) |
| 11 | Only Python (pytest) and TypeScript (vitest-shaped) test-file location conventions are needed for this repo; no third language's integration path applies | Ticket gives exactly two path patterns; repo scan shows Python + TypeScript/JS as the only test-bearing languages of scale | decided | Q7 (language-specific location policy) |

## 9. Classification Metadata

```yaml
estimated_files: 14
estimated_loc: 650
clusters_touched:
  - datum/gate.py
  - datum/lane_plan.py
  - datum/lane_spec_export.py
  - datum/models/lane_plan_schema.py
  - datum/skeleton_creator.py
  - skills/datum-properties (prompt template)
  - docs/FLOW.md
  - SKILL.md
new_public_api:
  - "gate.py: invariant_missing_for_question error code"
  - "gate.py: invariant_covers_unknown_task error code"
  - "gate.py: no_integration_invariants warning"
  - "lane_plan.py: merge-frontier grouping helper (derive_integration_lanes or equivalent)"
  - "lane_plan_schema.py: widened task-INT-<n> id pattern"
  - "skeleton_creator.py: invariant-id-aware make_function_name path"
dependency_additions: []
```
