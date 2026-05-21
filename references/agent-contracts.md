# Agent Contracts

Every agent in the DATUM pipeline operates under a typed contract. The orchestrator is responsible for fulfilling its side before dispatching; the agent is responsible for fulfilling its side before the orchestrator proceeds. Neither party is allowed to proceed on a contract violation — surface it and halt.

These are **hard contracts**, not style guidelines. If the orchestrator sends a malformed brief, the agent must reject it. If the agent returns a malformed result, the orchestrator must not process it. Soft failures here cascade into silent correctness bugs.

---

## Contract Schema Version

Every contract payload carries `"contract_version": "1.0"`. If either party receives a version it doesn't recognize, it rejects with `"error": "unsupported_contract_version"` and halts.

## Canonical Result Schemas

Agent results validate against role-specific schemas:
- `assets/schemas/result-red.schema.json`
- `assets/schemas/result-green.schema.json`
- `assets/schemas/result-refactor.schema.json`
- `assets/schemas/result-adversarial.schema.json`

`assets/schemas/executor-result.schema.json` defines the common shape. Key additions:

**Per-AC verdict (required):** Every result must report every AC from the task brief by ID:
```json
"acceptance_criteria": [
  {"id": "AC1", "satisfied": true,  "evidence": "Tests/RecordingTests.swift:42"},
  {"id": "AC2", "satisfied": false, "reason": "timeout not implemented"}
]
```
Omitting an AC is a contract violation — treat as `satisfied: false`.

**`done_with_risks` status:** REFACTOR may return `status: done_with_risks` when all ACs
are satisfied and tests pass, but residual risks need supervisor attention. See
`references/04-act-completed-with-risks.md`. High-severity risks halt the Review gate.

**Skeleton traceability:** Results for lanes with skeleton preflight include
`acceptance_criteria[].skeleton_function` — the test function name from `preflight-result.json`
that proves the AC. REFACTOR validates this function exists before marking `satisfied: true`.

---

## RED Agent Contract

### Orchestrator → RED (the brief)

Required fields. Rejection if any is absent or null:

```json
{
  "contract_version": "1.0",
  "agent_role": "RED",
  "task_id": "task-001",
  "run_id": "epic-1-20260101-120000",
  "spec_excerpt": "<relevant SPEC sections, non-empty string>",
  "properties": [
    {
      "id": "SAFE-001",
      "category": "SAFETY",
      "predicate": "The recording session NEVER starts without camera permission granted."
    }
  ],
  "acceptance_criteria": ["AC1: ...", "AC2: ..."],
  "files_to_write": ["Tests/Unit/Domain/RecordingTests.swift"],
  "red_note": "Test must assert RecordingError.permissionDenied is thrown when permissionGranted=false",
  "introduces_stubs": true,
  "stub_files": ["Sources/Domain/RecordingError.swift"],
  "language": "swift",
  "framework": "xctest",
  "gitnexus_context": "<string or null if degraded>",
  "upstream_stubs": [
    { "file": "Sources/Domain/RecordingError.swift", "content": "..." }
  ],
  "lane_tools_readme": "<full README.md content>"
}
```

Forbidden fields (orchestrator must verify absence before dispatch):
- Any path matching test directory patterns in `spec_excerpt` or `gitnexus_context`
- `implementation_files` key
- `test_signal` key

### RED → Orchestrator (the result)

Required on success:

```json
{
  "contract_version": "1.0",
  "agent_role": "RED",
  "task_id": "task-001",
  "status": "done",
  "commits": [
    {
      "type": "stub",
      "files": ["Sources/Domain/RecordingError.swift"],
      "patch": "<unified diff>",
      "message": "stub(task-001): declare RecordingError public API"
    },
    {
      "type": "test",
      "files": ["Tests/Unit/Domain/RecordingTests.swift"],
      "patch": "<unified diff>",
      "message": "red(task-001): failing test for SAFE-001"
    }
  ],
  "verified_red": true,
  "failure_property_id": "SAFE-001",
  "failure_message": "<assertion text from test runner that references the property>",
  "acceptance_criteria": [
    {"id": "AC1", "satisfied": false, "reason": "RED test fails before implementation"}
  ]
}
```

`verified_red` must be `true` — meaning `test_signal.py` returned `status: fail` with the expected `property_id` present. The orchestrator rejects the result if `verified_red` is `false`.

On failure:
```json
{
  "contract_version": "1.0",
  "agent_role": "RED",
  "task_id": "task-001",
  "status": "failed",
  "reason": "<what went wrong>",
  "retryable": true
}
```

**Orchestrator actions on RED result:**
- `status: done` AND `verified_red: true` → submit commits to commit queue; advance lane to GREEN
- `status: done` AND `verified_red: false` → treat as reasoning failure; run retry ladder
- `status: failed` AND `retryable: true` → run `diagnose_failure.py`; decide ENVIRONMENTAL or REASONING
- `status: failed` AND `retryable: false` → halt lane; surface to user

---

## GREEN Agent Contract

### Orchestrator → GREEN (the brief)

Required fields:

```json
{
  "contract_version": "1.0",
  "agent_role": "GREEN",
  "task_id": "task-001",
  "run_id": "epic-1-20260101-120000",
  "spec_excerpt": "...",
  "properties": [...],
  "acceptance_criteria": [...],
  "files_to_write": ["Sources/Domain/RecordingError.swift"],
  "language": "swift",
  "framework": "xctest",
  "test_signal": {
    "status": "fail",
    "assertion_failures": [...],
    "compile_errors": [...],
    "runtime_errors": [...]
  },
  "gitnexus_context": "...",
  "lane_tools_readme": "...",
  "attempt": 1
}
```

**Pre-dispatch invariant check (orchestrator must verify):**
1. `test_signal.status` must NOT be `"redaction_failed"` → if it is, halt lane, do not dispatch
2. No field in the brief may contain content from test source files — run a canary check: scan brief text for any string that appears verbatim in files under the test directory
3. `files_to_write` must not contain any test file paths

Forbidden fields:
- `test_source` key — absolute prohibition
- `test_names` key
- `red_commit_message` key
- `red_brief` key

### GREEN → Orchestrator (the result)

```json
{
  "contract_version": "1.0",
  "agent_role": "GREEN",
  "task_id": "task-001",
  "status": "done",
  "commits": [
    {
      "type": "implementation",
      "files": ["Sources/Domain/RecordingError.swift"],
      "patch": "<unified diff>",
      "message": "green(task-001): minimum implementation for SAFE-001"
    }
  ],
  "verified_green": true,
  "attempt": 1,
  "acceptance_criteria": [
    {"id": "AC1", "satisfied": true, "evidence": "Sources/Domain/RecordingError.swift:42"}
  ]
}
```

`verified_green` must be `true` — meaning `test_signal.py` returned `status: pass` after GREEN's commit. The orchestrator rejects the result if false and spawns a new GREEN agent (no same-agent retry).

On failure:
```json
{
  "contract_version": "1.0",
  "agent_role": "GREEN",
  "task_id": "task-001",
  "status": "failed",
  "attempt": 1,
  "reason": "...",
  "retryable": true
}
```

**Orchestrator actions on GREEN result:**
- `verified_green: true` → submit commit to queue; advance lane to REFACTOR
- `verified_green: false` OR `status: failed` AND `turn < green_max_turns` → send **continuation turn** on the same thread (see `references/04-act-green-multiturn.md`)
- `verified_green: false` OR `status: failed` AND `turn >= green_max_turns` → session exhausted; spawn **new** Reasoning-tier agent; increment attempt counter
- `attempt >= 3` (post-session escalations) AND still failing → halt lane; `tests_red_after_3x_retry` hard stop fires

### Continuation turn brief (orchestrator → GREEN, same thread)

Required fields when sending a continuation:

```json
{
  "contract_version": "1.0",
  "agent_role": "GREEN",
  "turn_type": "continuation",
  "task_id": "task-001",
  "turn": 2,
  "green_max_turns": 3,
  "test_signal": { "status": "fail", "assertion_failures": [...] },
  "diff_since_last_attempt": "<unified diff of what changed vs. prior turn>",
  "message": "The previous attempt did not pass. Updated signal above. Files and context unchanged."
}
```

The continuation brief omits `spec_excerpt`, `properties`, `gitnexus_context`, `lane_tools_readme`,
and `acceptance_criteria` — these are already in the thread history. The orchestrator validates
that these fields are absent before sending.

---

## REFACTOR Agent Contract

### Orchestrator → REFACTOR (the brief)

```json
{
  "contract_version": "1.0",
  "agent_role": "REFACTOR",
  "task_id": "task-001",
  "run_id": "epic-1-20260101-120000",
  "spec_excerpt": "...",
  "properties": [...],
  "acceptance_criteria": [...],
  "files_to_write": ["Sources/Domain/RecordingError.swift"],
  "language": "swift",
  "framework": "xctest",
  "implementation_files": [
    { "path": "Sources/Domain/RecordingError.swift", "content": "..." }
  ],
  "test_files": [
    { "path": "Tests/Unit/Domain/RecordingTests.swift", "content": "..." }
  ],
  "test_results": "<full runner output>",
  "gitnexus_impact": "...",
  "lane_tools_readme": "...",
  "brief_defects_so_far": []
}
```

No exclusions — REFACTOR is the only agent permitted to see test source.

### REFACTOR → Orchestrator (the result)

```json
{
  "contract_version": "1.0",
  "agent_role": "REFACTOR",
  "task_id": "task-001",
  "status": "done",
  "commits": [
    {
      "type": "refactor",
      "files": ["Sources/Domain/RecordingError.swift"],
      "patch": "<unified diff>",
      "message": "refactor(task-001): full AC coverage\n\nProperties: SAFE-001\n..."
    }
  ],
  "verified_green": true,
  "ac_checklist": [
    { "ac": "AC1: ...", "satisfied": true, "evidence": "line 42 in RecordingError.swift" },
    { "ac": "AC2: ...", "satisfied": true, "evidence": "..." }
  ],
  "gemba_verdict": {
    "decision": "Choosing between async/await and Combine for the recorder protocol",
    "rationale": "Combine was chosen to match existing patterns in the project, despite async/await being more modern.",
    "friction_score": 7
  },
  "missing_acs": [],
  "lane_tools_added": [],
  "brief_defects": [],
  "acceptance_criteria": [
    {"id": "AC1", "satisfied": true, "evidence": "Sources/Domain/RecordingError.swift:42"}
  ]
}
```

If REFACTOR finds a missing AC, it must **not** write the test. Instead:

```json
{
  "contract_version": "1.0",
  "agent_role": "REFACTOR",
  "task_id": "task-001",
  "status": "missing_ac",
  "missing_acs": [
    { "ac": "AC3: timeout after 30s", "reason": "Not covered by any test — needs RED-GREEN cycle" }
  ]
}
```

**Orchestrator actions on REFACTOR result:**
- `status: done` AND `verified_green: true` AND all ACs satisfied → submit commit; mark lane `completed`
- `status: done` AND any AC `satisfied: false` → treat as reasoning failure; retry REFACTOR
- `status: missing_ac` → log to `brief_defects`; spawn new RED-GREEN cycle for the missing ACs; proceed with lane for existing ACs
- `status: failed` → retry ladder; at 3x halt lane

---

## Orchestrator-Side Contract Enforcement

The orchestrator must validate every brief before dispatch and every result before acting on it:

```bash
python3 scripts/contracts.py validate \
  --schema assets/schemas/brief-red.schema.json \
  --input .datum/runs/<RUN_ID>/briefs/task-001-red.json

python3 scripts/contracts.py validate \
  --schema assets/schemas/result-green.schema.json \
  --input .datum/runs/<RUN_ID>/results/task-001-green.json
```

On `ContractViolationError`:
- **Brief violation (outbound)**: Bug in the orchestrator. Log the error, halt the lane, surface with "orchestrator produced malformed brief for task-XXX". Do not dispatch the malformed brief.
- **Result violation (inbound)**: Agent returned an invalid response. Treat as a reasoning failure; enter retry ladder. On 3x: halt lane with "agent returned contract-violating result".

The schemas referenced above (`brief-red.schema.json`, etc.) in `assets/schemas/` define the exact fields, types, and required/forbidden sets. They are the authoritative source; this doc is the human-readable companion. Run `python3 scripts/contracts.py self-test` to validate bundled fixtures.

---

## Contract Violations That Are Hard Stops

These contract violations are not retryable — they indicate a structural bug, not a transient failure:

| Violation | Classification |
|---|---|
| GREEN brief contains test source content | Hard stop — investigate test_signal.py canary; do not retry until the leak is fixed |
| `test_signal.py` returns `redaction_failed` and GREEN was dispatched anyway | Hard stop — orchestrator bug |
| REFACTOR result contains a test weakening that bypassed test_ratchet.py | Hard stop — investigate pre-commit hook installation |
| Any result with `contract_version` the orchestrator doesn't recognize | Hard stop — skill version mismatch; run `datum migrate` |
