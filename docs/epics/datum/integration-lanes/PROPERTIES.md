# PROPERTIES.md — Integration Lanes

Derived from `docs/epics/datum/integration-lanes/SPEC.md` (R1–R10) and `docs/epics/datum/integration-lanes/TASKS.md` (task-001..task-009). Every SPEC requirement is mapped to at least one testable property per applicable category; every task in TASKS.md is mapped to at least one property.

## 1. Properties by Category

### SAFETY — what must NEVER happen

- PROPERTY(SAFETY-001): `gate_properties` never passes a `PROPERTIES.md` that is missing the `## Integration Invariants` heading (AC1.4).
- PROPERTY(SAFETY-002): `gate_plan` never accepts a `task-INT-<n>` lane whose `depends_on` (as a set) differs from the union of its invariants' `Covers` task ids (AC9.1).
- PROPERTY(SAFETY-003): `gate_plan` never accepts a non-integration lane (`kind` absent/`task`/`behavioral`/`structural`) whose `depends_on` includes a `task-INT-*` id (AC9.2).
- PROPERTY(SAFETY-004): `gate_plan` never accepts a plan where an invariant's `Covers` names a task id absent from `tasks.json` (AC3.4).
- PROPERTY(SAFETY-005): an INT lane never causes GREEN implementation code to be written in this slice — skeleton generation produces only failing placeholder tests, never source changes (R6, Out of Scope §6).
- PROPERTY(SAFETY-006): `gate_properties` never accepts an invariant row whose `Covers` has fewer than 2 entries when `Source` is `spec:<section>` (AC1.2).
- PROPERTY(SAFETY-007): the widened `task-(\d+|INT-\d+)$` id pattern in `lane_plan_schema.py` never accepts a malformed id (`task-abc`, `task-INT-`, `task-INT-x`, `taskINT-1`, `TASK-001`, `task-INT-1-extra`) (task-003 ACs, AC3.5).

### LIVENESS — what must EVENTUALLY happen

- PROPERTY(LIVENESS-001): every answered question in `QUESTIONS.md` (per `check_questions_answered`'s regex) eventually has exactly one Integration Invariant row with `Source` = `question:Q<N>` (AC2.1, AC2.5).
- PROPERTY(LIVENESS-002): every merge-frontier group of invariants eventually is scheduled as exactly one `task-INT-<n>` lane, numbered from 1 (AC3.1, AC3.3).
- PROPERTY(LIVENESS-003): every `task-INT-<n>` lane eventually gets its designated single test file created with one skeleton test per acceptance criterion (AC6.1).
- PROPERTY(LIVENESS-004): `docs/FLOW.md` and `SKILL.md` eventually document integration lanes, the `integration` `kind`, and the new gate error/warning names (AC10.1, AC10.2).

### INVARIANT — what must ALWAYS be true

- PROPERTY(INV-001): the Integration Invariants table's columns are always exactly `ID | Invariant | Covers | Source`, in that order (AC1.1).
- PROPERTY(INV-002): the number of skeleton test functions generated for an INT lane always equals `len(acceptance_criteria)` for that lane (AC7.1, AC7.2).
- PROPERTY(INV-003): `kind` is always present as `"integration"` on every INT lane's digest and exported spec, and always absent/`"task"` for ordinary lanes, across digest and export (AC4.1–AC4.3).
- PROPERTY(INV-004): a task lane's `contract_summary()` output is always byte-identical to its pre-slice output (AC5.3).
- PROPERTY(INV-005): `derive_integration_lanes` always partitions invariants so that no invariant appears in more than one lane — the covered-task tuple is always the sole grouping key (SPEC §4, row: "identical covered-task tuple... not possible by construction").

### BOUNDARY — valid input ranges

- PROPERTY(BOUND-001): `Covers` list length is always ≥ 2 unless `Source` is `question:Q<N>`, in which case exactly 1 entry is valid (AC1.2).
- PROPERTY(BOUND-002): `Source` column matches exactly one of `spec:<section>` or `question:Q<N>`; any other value is rejected (AC1.3, AC2.5).
- PROPERTY(BOUND-003): a `task-INT-<n>` id is valid iff `n` is one-or-more digits with no extra trailing/leading characters (task-003 negative-case AC list).
- PROPERTY(BOUND-004): an Integration Invariants table row is valid only when it has exactly 4 cells (`malformed_invariant_row`) (task-001 AC list).

### IDEMPOTENT — what is safe to run twice

- PROPERTY(IDEM-001): `derive_integration_lanes(invariants, tasks, test_command)` called twice on identical inputs, or on inputs constructed in a different insertion order, returns an equal list of lane dicts (task-004 determinism AC).
- PROPERTY(IDEM-002): `build_lane_plan(..., properties_path=None)` run repeatedly on the same `tasks.json` always returns a byte-identical plan (task-005 AC, no-op regression).
- PROPERTY(IDEM-003): running `gate_properties`/`gate_plan` twice against an unchanged `PROPERTIES.md`/`tasks.json`/`QUESTIONS.md` produces the same pass/fail verdict and the same message set both times (general gate re-run safety, gate-performance NFR).

### ORDERING — order invariants

- PROPERTY(ORDER-001): merge-frontier group numbering (`task-INT-<n>`, `n` from 1) follows topological order of covered-task ancestry, with ties broken by ascending covered-task-id order (AC3.2).
- PROPERTY(ORDER-002): each INT lane's id is appended to `topological_order` strictly after all of its covered task ids (task-005 AC).
- PROPERTY(ORDER-003): each Integration Invariant's position in its source table is preserved into the INT lane's `acceptance_criteria` list (AC3.3, "in table order").
- PROPERTY(ORDER-004): `PROPERTIES.md`, `QUESTIONS.md`, and `tasks.json` are each read/parsed at most once per single `gate_properties`/`gate_plan` invocation, regardless of how many invariant/question checks run (gate-performance NFR).

### ISOLATION — what cannot leak between contexts

- PROPERTY(ISO-001): the `malformed_invariant_*` message strings are owned and emitted only by `datum/integration_invariants.py` (task-001); `gate_properties` (task-002) surfaces them verbatim and `gate_plan` (task-006) never re-defines or duplicates them.
- PROPERTY(ISO-002): edits to `gate_properties` (task-002) and `gate_plan` (task-006) in shared `datum/gate.py` never cross into each other's function bodies — each lane's diff is confined to its own function.
- PROPERTY(ISO-003): routing INT lane skeletons to a single shared file never changes skeleton output (path, count, naming) for non-integration lanes in the same `run_batch` invocation (AC6.3).
- PROPERTY(ISO-004): the integration-specific `contract_summary` note is injected only by `export_lane_spec` for `kind == 'integration'` lanes and never mutates `contract_summary()`'s own return value for any lane (AC5.2, AC5.3).
- PROPERTY(ISO-005): a lane plan built with no `PROPERTIES.md`/invariants never has INT-lane-only keys (`kind`, `expect_tests_pass`) leak onto ordinary task lane dicts (task-005 no-op AC).

### PERFORMANCE — latency/throughput/size bounds

- PROPERTY(PERF-001): `gate_properties` adds at most one additional linear pass over `PROPERTIES.md` content per invocation versus pre-slice behavior (gate-performance NFR).
- PROPERTY(PERF-002): `gate_plan` adds at most one additional linear pass over `tasks.json`/`PROPERTIES.md` content per invocation versus pre-slice behavior (gate-performance NFR).
- PROPERTY(PERF-003): `PROPERTIES.md` and `QUESTIONS.md` are each read from disk exactly once inside a single `gate_properties` call (task-002 AC).
- PROPERTY(PERF-004): `tasks.json` and `PROPERTIES.md` are each read from disk exactly once inside a single `gate_plan` call (task-006 AC).

### SECURITY — access controls

- PROPERTY(SEC-001): every INT lane's `files` entry resolves to exactly one path under `tests/integration/` or `src/integration/` matching the fixed `test_int_<n>.py` / `int-<n>.test.ts` templates — no invariant-derived or task-derived string is interpolated unsanitized into the path (AC3.3).
- PROPERTY(SEC-002): the skeleton creator writes only to the lane's declared `files[0]` path for an INT lane and never to a path outside that lane's declared file ownership (AC6.1, file-ownership integrity).
- PROPERTY(SEC-003): the widened schema pattern never admits an id that could be used to escape the `task-<n>`/`task-INT-<n>` namespace (e.g. path-traversal-shaped ids), verified by the same negative-id test set as SAFETY-007/BOUND-003 (task-003 AC).

### OBSERVABILITY — what must be logged or measured

- PROPERTY(OBS-001): `no_integration_invariants` is written to stderr exactly once, with process exit code 0, whenever the plan has zero `task-INT-*` lanes and the invariants table is empty (AC8.2).
- PROPERTY(OBS-002): `invariant_missing_for_question: Q<N>` is emitted once per offending answered question with no matching invariant row (AC2.5).
- PROPERTY(OBS-003): `invariant_covers_unknown_task: <ID> -> <task>` is emitted once per offending `Covers` entry referencing an unknown task (AC3.4).
- PROPERTY(OBS-004): `gate_properties` surfaces the underlying `IntegrationInvariantError` message text verbatim (no re-wording/truncation) on malformed-table failures (task-002 AC).
- PROPERTY(OBS-005): `invariant_duplicate_for_question: Q<N>` is emitted when more than one invariant row shares the same `question:Q<N>` source (task-002 AC).

### COMPATIBILITY — existing behavior that must be preserved

- PROPERTY(COMPAT-001): `build_lane_plan(..., properties_path=None)` returns a plan byte-identical to the current pre-slice output for the same `tasks.json` input (task-005 AC).
- PROPERTY(COMPAT-002): `lane_plan_digest` on a pre-slice plan (no `kind` key on any lane) digests every lane with no synthesized `kind` key — no `"task"` default is introduced (AC4.1 as corrected by the task-005 RED note; supersedes a literal reading of AC4.1).
- PROPERTY(COMPAT-003): `export_lane_spec` output for a task lane (`kind` absent/`task`/`behavioral`/`structural`) is byte-identical to its pre-slice output, with no `expect_tests_pass` key present (AC4.3, AC5.3).
- PROPERTY(COMPAT-004): `make_function_name(ac_id, ac_text, language)`'s existing three-positional-argument call contract and its output for every existing non-integration caller are unchanged (AC6.3).
- PROPERTY(COMPAT-005): a lane plan containing only ordinary `task-<n>` ids continues to validate against the widened schema exactly as it did before the pattern was widened (task-003 AC).
- PROPERTY(COMPAT-006): `gate_plan`'s pre-existing checks (schema validation, per-lane field checks, `depends_on` referential integrity, file-overlap-vs-dependency, assumption audit, `topological_order`/`lanes` equality) produce identical results on a plan with zero INT lanes (task-006 AC).

## 2. Traceability Table

| Property ID | Category | Predicate (short) | Task IDs |
|---|---|---|---|
| SAFETY-001 | SAFETY | Missing `## Integration Invariants` heading always fails `gate_properties` | task-001, task-002 |
| SAFETY-002 | SAFETY | INT lane `depends_on` ≠ union of covered tasks always fails `gate_plan` | task-004, task-006 |
| SAFETY-003 | SAFETY | Non-integration lane depending on `task-INT-*` always fails `gate_plan` | task-006 |
| SAFETY-004 | SAFETY | Unknown covered task in `Covers` always fails `gate_plan` | task-004, task-006 |
| SAFETY-005 | SAFETY | INT lane skeletons never write GREEN/source code | task-008 |
| SAFETY-006 | SAFETY | `Covers` < 2 entries with `Source: spec:*` always fails `gate_properties` | task-002 |
| SAFETY-007 | SAFETY | Malformed `task-INT-*` ids always rejected by schema | task-003 |
| LIVENESS-001 | LIVENESS | Every answered question eventually gets exactly one invariant row | task-001, task-002 |
| LIVENESS-002 | LIVENESS | Every merge frontier eventually becomes one `task-INT-<n>` lane | task-004, task-005 |
| LIVENESS-003 | LIVENESS | Every INT lane eventually gets its skeleton file with N tests | task-008 |
| LIVENESS-004 | LIVENESS | Docs eventually describe integration lanes/kind/gate names | task-009 |
| INV-001 | INVARIANT | Table columns always `ID\|Invariant\|Covers\|Source` | task-001 |
| INV-002 | INVARIANT | Skeleton function count always equals AC/invariant count | task-007, task-008 |
| INV-003 | INVARIANT | `kind` always correct through digest and export | task-005, task-007 |
| INV-004 | INVARIANT | Task lane `contract_summary` always byte-identical pre/post | task-007 |
| INV-005 | INVARIANT | No invariant ever appears in more than one INT lane | task-004 |
| BOUND-001 | BOUNDARY | `Covers` length rule (≥2, or =1 for `question:Q<N>`) | task-002 |
| BOUND-002 | BOUNDARY | `Source` matches only the two allowed patterns | task-001, task-002 |
| BOUND-003 | BOUNDARY | `task-INT-<n>` id digit-only validity range | task-003 |
| BOUND-004 | BOUNDARY | Table row must have exactly 4 cells | task-001 |
| IDEM-001 | IDEMPOTENT | `derive_integration_lanes` deterministic/idempotent across input order | task-004 |
| IDEM-002 | IDEMPOTENT | `build_lane_plan(properties_path=None)` idempotent no-op | task-005 |
| IDEM-003 | IDEMPOTENT | Re-running gates on unchanged inputs gives same verdict | task-002, task-006 |
| ORDER-001 | ORDERING | INT lane numbering is topological with deterministic tie-break | task-004 |
| ORDER-002 | ORDERING | INT lane id placed after covered tasks in `topological_order` | task-005 |
| ORDER-003 | ORDERING | Invariant table order preserved into `acceptance_criteria` | task-001, task-004 |
| ORDER-004 | ORDERING | Each source file parsed at most once per gate invocation | task-002, task-006 |
| ISO-001 | ISOLATION | `malformed_invariant_*` strings owned solely by task-001 | task-001, task-002, task-006 |
| ISO-002 | ISOLATION | `gate_properties`/`gate_plan` diffs don't cross function boundaries | task-002, task-006 |
| ISO-003 | ISOLATION | INT skeleton routing doesn't affect task-lane skeleton output | task-008 |
| ISO-004 | ISOLATION | Integration note injected only in `export_lane_spec`, never in `contract_summary` | task-007 |
| ISO-005 | ISOLATION | No INT-only keys leak onto ordinary lanes in a no-invariant plan | task-005 |
| PERF-001 | PERFORMANCE | `gate_properties` adds ≤1 extra linear pass | task-002 |
| PERF-002 | PERFORMANCE | `gate_plan` adds ≤1 extra linear pass | task-006 |
| PERF-003 | PERFORMANCE | `PROPERTIES.md`/`QUESTIONS.md` read once per `gate_properties` call | task-002 |
| PERF-004 | PERFORMANCE | `tasks.json`/`PROPERTIES.md` read once per `gate_plan` call | task-006 |
| SEC-001 | SECURITY | INT lane file paths always match fixed safe templates | task-004, task-005 |
| SEC-002 | SECURITY | Skeleton writes confined to lane's declared `files[0]` | task-008 |
| SEC-003 | SECURITY | Widened id pattern never admits namespace-escaping ids | task-003 |
| OBS-001 | OBSERVABILITY | `no_integration_invariants` on stderr, exit 0, exactly once | task-006 |
| OBS-002 | OBSERVABILITY | `invariant_missing_for_question: Q<N>` emitted per offending question | task-002 |
| OBS-003 | OBSERVABILITY | `invariant_covers_unknown_task: <ID> -> <task>` emitted per offending entry | task-006 |
| OBS-004 | OBSERVABILITY | `IntegrationInvariantError` message surfaced verbatim | task-001, task-002 |
| OBS-005 | OBSERVABILITY | `invariant_duplicate_for_question: Q<N>` emitted on duplicate rows | task-002 |
| COMPAT-001 | COMPATIBILITY | `build_lane_plan` no-op with `properties_path=None` | task-005 |
| COMPAT-002 | COMPATIBILITY | Pre-slice plan digest unchanged, no synthesized `kind` | task-005 |
| COMPAT-003 | COMPATIBILITY | Task lane export byte-identical, no `expect_tests_pass` | task-007 |
| COMPAT-004 | COMPATIBILITY | `make_function_name` 3-arg contract/output unchanged | task-008 |
| COMPAT-005 | COMPATIBILITY | Ordinary-id-only plans validate exactly as before | task-003 |
| COMPAT-006 | COMPATIBILITY | Pre-existing `gate_plan` checks unaffected by zero INT lanes | task-006 |

## 3. Per-Task Property Assignments

- **task-001** (parse Integration Invariants table): INV-001, BOUND-002, BOUND-004, ORDER-003, ISO-001, OBS-004, LIVENESS-001, SAFETY-001 (shared).
- **task-002** (gate_properties enforcement): SAFETY-001, SAFETY-006, LIVENESS-001, BOUND-001, BOUND-002, IDEM-003, ORDER-004, ISO-001, ISO-002, PERF-001, PERF-003, OBS-002, OBS-004, OBS-005.
- **task-003** (widen schema id patterns): SAFETY-007, BOUND-003, SEC-003, COMPAT-005.
- **task-004** (group invariants into merge frontiers): SAFETY-004, LIVENESS-002, INV-005, IDEM-001, ORDER-001, ORDER-003, SEC-001, SAFETY-002 (shared with task-006).
- **task-005** (wire INT lanes into build_lane_plan): LIVENESS-002, INV-003, IDEM-002, ORDER-002, ISO-005, SEC-001, COMPAT-001, COMPAT-002.
- **task-006** (gate_plan INT checks): SAFETY-002, SAFETY-003, SAFETY-004, IDEM-003, ORDER-004, ISO-001, ISO-002, PERF-002, PERF-004, OBS-001, OBS-003, COMPAT-006.
- **task-007** (export contract_summary + expect_tests_pass): INV-002, INV-003, INV-004, ISO-004, COMPAT-003.
- **task-008** (skeleton creator INT routing): SAFETY-005, LIVENESS-003, INV-002, ISO-003, SEC-002, COMPAT-004.
- **task-009** (documentation): LIVENESS-004. **FLAGGED**: this lane is prose/doc-only with no RED/GREEN test (per its own RED note: "no testable behavior, so this lane runs a single commit stage with no RED/GREEN"). LIVENESS-004 is verifiable only as a content-existence/grep check against `docs/FLOW.md` and `SKILL.md` (presence of required section and exact error-name strings), not as a unit-test-level predicate. No stronger property category applies because this lane changes no executable code path.

## 4. Notes

- Property IDs use flat numbering per category (not per-requirement) since several SPEC requirements share properties (e.g. R3/R8 both drive ORDER-001/IDEM-001/SAFETY-004).
- COMPAT-002 intentionally states the corrected AC4.1 semantics (no synthesized `kind: "task"` default) per the task-005 RED note's explicit resolution of the AC4.1/NFR conflict documented in SPEC.md §3 R4 vs. §5 Backward Compatibility.
- Every task in TASKS.md (task-001 through task-009) has at least one assigned property; task-009 is flagged as doc-only with a content-level rather than behavioral property.
