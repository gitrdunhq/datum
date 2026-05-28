# Spec: Post-Epic-1 Hardening

**Run ID:** epic-2-20260527
**Phase:** Refine
**Status:** Draft

---

## 1. Summary

Four targeted fixes to friction points and transgressions identified during epic-1: complete gate path resolution, enforce Triage/Deepen sequencing, mandate GitNexus-first in Deepen, and auto-increment branch naming.

## 2. Context

During epic-1, three process failures occurred that should be structurally prevented: gates checking root paths instead of epic dir, Triage phase skipped entirely, and Deepen used grep instead of GitNexus. A fourth friction point — branch name collision on `datum init` — was discovered at epic-2 start.

## 3. Requirements

### R1: Complete gate path resolution

**Description:** Audit all gate functions in `datum/gate.py`. Every function that reads SPEC.md, TASKS.md, PROPERTIES.md, or QUESTIONS.md must use `resolve_epic_dir()` first, root fallback second.

**Acceptance criteria:**
- [ ] AC1: `gate_properties()` resolves PROPERTIES.md from epic dir
- [ ] AC2: `gate_validate()` checks epic dir for test artifacts
- [ ] AC3: `gate_deepen()` resolves TASKS.md from epic dir
- [ ] AC4: No gate function uses bare `Path("SPEC.md")` or `Path("PROPERTIES.md")` without trying epic dir first

### R2: Triage/Deepen enforcement

**Description:** Make the Plan → Triage sequence non-skippable in SKILL.md dispatcher.

**Acceptance criteria:**
- [ ] AC1: SKILL.md dispatcher step 5 explicitly states: after Plan gate passes, next phase is always Triage
- [ ] AC2: Triage is not listed as optional or skippable in the dispatch table

### R3: GitNexus-first in Deepen

**Description:** Update `references/02.8-deepen.md` to mandate GitNexus MCP tools when available.

**Acceptance criteria:**
- [ ] AC1: Step 2 says "use `gitnexus_context()` for symbol lookups, `gitnexus_query()` for concept search"
- [ ] AC2: Step 2 says "use OpenGrep for pattern matching"
- [ ] AC3: grep/grep_search is listed as last resort when both GitNexus and OpenGrep are unavailable

### R4: Branch naming auto-increment

**Description:** `datum init` should create `datum/epic-{N}` where N is the next available number.

**Acceptance criteria:**
- [ ] AC1: `ensure_feature_branch()` in `datum/state.py` checks existing `docs/epics/datum/epic-*` dirs to find max N
- [ ] AC2: New branch is `datum/epic-{N+1}`
- [ ] AC3: If no prior epics exist, starts at `datum/epic-1`

## 4. Failure Modes and Handling

| Failure | Handling |
|---|---|
| Epic dir doesn't exist when gate runs | Fall back to root path (existing behavior) |
| Branch name already exists in git | Increment N until an unused name is found |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Gate resolution overhead | < 100ms (subprocess call to git rev-parse) |

## 6. Out of Scope

- Changing gate validation logic (only changing path resolution)
- Adding new gates or properties
- Modifying Act phase or any pipeline behavior beyond sequencing

## 7. Open Questions

*(none)*

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | `resolve_epic_dir()` already works correctly | It was tested in epic-1 with 12 passing gate tests | confirmed | n/a |
| 2 | SKILL.md changes are sufficient to enforce Triage sequencing | The dispatcher is prose instructions, not code — the LLM follows them | confirmed | n/a |
| 3 | `docs/epics/datum/epic-*` glob is reliable for counting | Standard Python glob, tested implicitly by epic-1 creating epic-1 dir | confirmed | n/a |

## 9. Classification Metadata

```yaml
estimated_files: 4
estimated_loc: 40
clusters_touched: 1
new_public_api: false
dependency_additions: []
```
