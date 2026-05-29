# Spec: TriageDecision Pydantic schema for structured triage output

**Run ID:** <!-- filled by datum -->
**Phase:** Refine
**Status:** Draft

---

## 1. Summary

Add `datum/models/triage_decision_schema.py` defining `TriageDecision(BaseModel)`
with `decision: Literal["deepen", "properties"]` and `reason: str`. Pass it as
`schema=TriageDecision` in the triage subagent's `run_phase()` call so MLX uses
grammar-constrained JSON generation instead of free-form text.

## 2. Context

`run_phase("triage", prompt, schema=None)` calls `chat()` (unstructured). The
output is raw text that callers manually `json.loads()` and hope is valid JSON.
With `schema=TriageDecision`, `run_phase` routes through `structured()` →
`outlines.Generator` → grammar-constrained generation: the output is guaranteed
to be valid JSON matching the schema, no parsing gamble.

## 3. Requirements

### R1: TriageDecision schema

**Acceptance criteria:**
- `datum/models/triage_decision_schema.py` exists
- Defines `TriageDecision(BaseModel)` with `decision: Literal["deepen", "properties"]` and `reason: str`
- Pydantic v2 validates cleanly
- `from datum.models.triage_decision_schema import TriageDecision` works

### R2: AGENTS.md triage subagent pattern updated

**Acceptance criteria:**
- `AGENTS.md` triage subagent example shows `schema=TriageDecision` in the `run_phase` call
- Import line shown: `from datum.models.triage_decision_schema import TriageDecision`

### R3: Tests

**Acceptance criteria:**
- `tests/test_triage_schema.py` with at least 3 tests:
  - Schema instantiates with valid data
  - `decision` field rejects values outside `["deepen", "properties"]`
  - `run_phase` called with `schema=TriageDecision` passes schema through to `structured()`

## 4. Failure Modes and Handling

| Failure | Handling |
|---|---|
| outlines rejects Literal type constraint | Fall back to `Enum` type with same values |
| Pydantic v2 Literal import issue | Use `typing.Literal` not `typing_extensions` |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| No new dependencies | Uses existing Pydantic v2 |
| Schema round-trips | `TriageDecision(decision="deepen", reason="x").model_dump()` works |

## 6. Out of Scope

- Modifying the live triage gate or `gate_triage()` in gate.py
- Migrating existing `.datum/routing.json` files

## 7. Open Questions

*(none)*

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | `structured(prompt, TriageDecision, model_id)` works with Literal fields | outlines uses JSON schema from Pydantic, Literal maps to enum constraint | confirmed | n/a |
| 2 | AGENTS.md update is sufficient — no runtime triage caller to change | Triage subagents are spawned by orchestrators reading AGENTS.md | confirmed | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 3
estimated_loc: 60
clusters_touched: 1
new_public_api: true
dependency_additions: []
```
