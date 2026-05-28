# Properties: AIDLC-Inspired Pipeline Enhancements

**Run ID:** epic-1-20260527
**Phase:** Properties

---

## Property Definitions

### Safety

| ID | Predicate | Tasks |
|---|---|---|
| SAFE-001 | The gate NEVER advances to Act when an assumption has Status "guess" without a resolved question | task-004 |
| SAFE-002 | The classifier NEVER routes a System-tier epic to Express pipeline | task-005 |
| SAFE-003 | lane_plan.py NEVER produces a lane-plan with a cyclic unit dependency graph | task-008 |
| SAFE-004 | The gate NEVER advances when QUESTIONS.md contains an unanswered [Answer]: entry | task-004 |

### Liveness

| ID | Predicate | Tasks |
|---|---|---|
| LIVE-001 | Once `datum classify` is called with a valid SPEC.md, it ALWAYS returns a JSON result within 2 seconds | task-005, task-007 |
| LIVE-002 | Once `datum landscape` is called, it ALWAYS produces docs/LANDSCAPE.md (scaffold or cached) | task-006, task-007 |
| LIVE-003 | Once all [Answer]: entries are filled, the QUESTIONS.md gate check ALWAYS passes | task-004 |

### Invariant

| ID | Predicate | Tasks |
|---|---|---|
| INV-001 | tasks.json as a plain list (no units) ALWAYS produces identical output to pre-change behavior | task-008 |
| INV-002 | SPEC.md template ALWAYS contains all 7 original required sections plus Assumption Audit and Classification Metadata | task-001 |
| INV-003 | Every gate function ALWAYS outputs valid JSON to stdout (passed/message or error fields) | task-004 |
| INV-004 | classify() output ALWAYS contains exactly three fields: tier, signals, pipeline_shape | task-005 |

### Boundary

| ID | Predicate | Tasks |
|---|---|---|
| BOUND-001 | classify() with estimated_loc=49, clusters_touched=1, new_public_api=false MUST return tier "patch" | task-005 |
| BOUND-002 | classify() with estimated_loc=50, clusters_touched=1, new_public_api=false MUST return tier "feature" (not patch) | task-005 |
| BOUND-003 | classify() with clusters_touched=5 MUST return tier "feature"; clusters_touched=6 MUST return tier "system" | task-005 |
| BOUND-004 | parse_classification_metadata with missing fields MUST return None for missing values, not raise | task-005 |
| BOUND-005 | generate_scaffold with an empty directory MUST produce valid markdown (not crash) | task-006 |

### Idempotent

| ID | Predicate | Tasks |
|---|---|---|
| IDEM-001 | Running `datum landscape` twice without file changes produces the same output (cache hit) | task-006 |
| IDEM-002 | Running `datum landscape --force` twice produces the same output (deterministic scan) | task-006 |
| IDEM-003 | Running gate_plan() twice on the same SPEC.md + QUESTIONS.md produces the same pass/fail result | task-004 |

### Ordering

| ID | Predicate | Tasks |
|---|---|---|
| ORD-001 | Classification Metadata MUST be filled in SPEC.md before `datum classify` can run | task-002, task-005 |
| ORD-002 | Assumption Audit MUST be completed before the plan_human_approval gate can pass | task-003, task-004 |
| ORD-003 | Unit dependency ordering: a unit's tasks MUST NOT start before all dependency units complete | task-008 |
| ORD-004 | QUESTIONS.md Refine section MUST be generated before Plan section is appended | task-002, task-003 |

### Isolation

| ID | Predicate | Tasks |
|---|---|---|
| ISOL-001 | Patch-tier classification MUST NOT trigger Properties phase or architect sidecar | task-005, task-010 |
| ISOL-002 | Unit groupings MUST NOT affect task-level topological sort within a unit | task-008 |
| ISOL-003 | GitNexus enrichment sections in LANDSCAPE.md (between markers) MUST NOT overwrite CLI scaffold content | task-006, task-009 |

### Performance

| ID | Predicate | Tasks |
|---|---|---|
| PERF-001 | `datum classify` MUST complete within 2 seconds (no network calls) | task-005, task-007 |
| PERF-002 | `datum landscape` MUST complete within 30 seconds on a 10K-file repo | task-006 |
| PERF-003 | `datum landscape` cache hit MUST return within 1 second | task-006 |

### Security

| ID | Predicate | Tasks |
|---|---|---|
| SEC-001 | *Exclusion note:* This epic modifies pipeline tooling, not user-facing systems. No authentication, authorization, or data protection boundaries are affected. Gate enforcement is a correctness concern (SAFETY), not a security concern. | — |

### Observability

| ID | Predicate | Tasks |
|---|---|---|
| OBS-001 | gate_plan() overconfidence check MUST emit a JSON warning field when zero Refine questions detected | task-004 |
| OBS-002 | classify() result MUST include a signals object showing which thresholds triggered the tier decision | task-005 |
| OBS-003 | landscape cache behavior (hit/miss/force) MUST be reported in the JSON output | task-006, task-007 |

### Compatibility

| ID | Predicate | Tasks |
|---|---|---|
| COMPAT-001 | Existing tasks.json files (plain list, no units) MUST produce identical lane-plan.json and TASKS.md output | task-008 |
| COMPAT-002 | Existing SPEC.md files without Assumption Audit or Classification Metadata MUST pass gate_refine() | task-004 |
| COMPAT-003 | Existing config.toml.default without [classification] section MUST not break datum doctor or any gate | task-007 |
| COMPAT-004 | gate_plan() with no QUESTIONS.md present MUST pass (backward compat for repos not using QUESTIONS.md) | task-004 |

---

## Traceability Table

| Property ID | Category | Predicate (short) | Task IDs |
|---|---|---|---|
| SAFE-001 | SAFETY | No Act with unresolved guess assumptions | task-004 |
| SAFE-002 | SAFETY | Classifier never routes System to Express | task-005 |
| SAFE-003 | SAFETY | No cyclic unit dependencies in lane plan | task-008 |
| SAFE-004 | SAFETY | No advancement with unanswered questions | task-004 |
| LIVE-001 | LIVENESS | classify always returns within 2s | task-005, task-007 |
| LIVE-002 | LIVENESS | landscape always produces output | task-006, task-007 |
| LIVE-003 | LIVENESS | Filled answers always pass gate | task-004 |
| INV-001 | INVARIANT | Plain-list backward compat identical output | task-008 |
| INV-002 | INVARIANT | SPEC template has all required sections | task-001 |
| INV-003 | INVARIANT | Gate output always valid JSON | task-004 |
| INV-004 | INVARIANT | classify output has exactly 3 fields | task-005 |
| BOUND-001 | BOUNDARY | 49 LOC + 1 cluster → patch | task-005 |
| BOUND-002 | BOUNDARY | 50 LOC + 1 cluster → feature (not patch) | task-005 |
| BOUND-003 | BOUNDARY | 5 clusters → feature; 6 → system | task-005 |
| BOUND-004 | BOUNDARY | Missing metadata fields → None not exception | task-005 |
| BOUND-005 | BOUNDARY | Empty dir → valid markdown | task-006 |
| IDEM-001 | IDEMPOTENT | Landscape double-run = cache hit | task-006 |
| IDEM-002 | IDEMPOTENT | Landscape force double-run = same output | task-006 |
| IDEM-003 | IDEMPOTENT | Gate double-run = same verdict | task-004 |
| ORD-001 | ORDERING | Metadata before classify | task-002, task-005 |
| ORD-002 | ORDERING | Audit before plan gate | task-003, task-004 |
| ORD-003 | ORDERING | Unit deps respected in scheduling | task-008 |
| ORD-004 | ORDERING | Refine questions before Plan questions | task-002, task-003 |
| ISOL-001 | ISOLATION | Patch tier skips Properties/architect | task-005, task-010 |
| ISOL-002 | ISOLATION | Units don't affect intra-unit task sort | task-008 |
| ISOL-003 | ISOLATION | GitNexus markers don't overwrite scaffold | task-006, task-009 |
| PERF-001 | PERFORMANCE | classify < 2s | task-005, task-007 |
| PERF-002 | PERFORMANCE | landscape < 30s on 10K files | task-006 |
| PERF-003 | PERFORMANCE | landscape cache hit < 1s | task-006 |
| SEC-001 | SECURITY | Exclusion: no user-facing security boundaries affected | — |
| OBS-001 | OBSERVABILITY | Zero-questions warning in gate output | task-004 |
| OBS-002 | OBSERVABILITY | classify signals in output | task-005 |
| OBS-003 | OBSERVABILITY | landscape cache status in output | task-006, task-007 |
| COMPAT-001 | COMPATIBILITY | Plain list tasks.json = identical output | task-008 |
| COMPAT-002 | COMPATIBILITY | Old SPEC.md passes gate_refine | task-004 |
| COMPAT-003 | COMPATIBILITY | Old config.toml works with new code | task-007 |
| COMPAT-004 | COMPATIBILITY | No QUESTIONS.md = gate passes | task-004 |

---

## Per-Task Property Assignment

### task-001: QUESTIONS.md and SPEC.md template updates
Properties to prove: INV-002

### task-002: Refine reference doc updates
Properties to prove: ORD-001, ORD-004

### task-003: Plan reference doc updates
Properties to prove: ORD-002, ORD-004

### task-004: Gate enhancements
Properties to prove: SAFE-001, SAFE-004, LIVE-003, INV-003, IDEM-003, OBS-001, COMPAT-002, COMPAT-004

### task-005: Classifier module
Properties to prove: SAFE-002, LIVE-001, INV-004, BOUND-001, BOUND-002, BOUND-003, BOUND-004, ORD-001, ISOL-001, PERF-001, OBS-002

### task-006: Landscape module
Properties to prove: LIVE-002, BOUND-005, IDEM-001, IDEM-002, ISOL-003, PERF-002, PERF-003, OBS-003

### task-007: CLI commands
Properties to prove: LIVE-001, LIVE-002, PERF-001, OBS-003, COMPAT-003

### task-008: lane_plan.py units extension
Properties to prove: SAFE-003, INV-001, ORD-003, ISOL-002, COMPAT-001

### task-009: Discovery reference doc
Properties to prove: ISOL-003

### task-010: SKILL.md final update
Properties to prove: ISOL-001
