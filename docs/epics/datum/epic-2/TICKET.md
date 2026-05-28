# TICKET: Post-Epic-1 Hardening

## Summary

Fix the three transgressions identified during epic-1: incomplete gate path resolution, missing Triage/Deepen enforcement in the dispatcher, and grep-first tooling in the Deepen reference doc.

## Requirements

### 1. Gate path resolution completeness

`gate_refine()` and `gate_plan()` now use `resolve_epic_dir()` but other gate functions still hardcode root paths. Audit all gate functions and ensure every artifact reference resolves from `docs/epics/<branch>/` first, root fallback second.

Affected functions to audit: `gate_properties()`, `gate_validate()`, `gate_review()`, `gate_deepen()`.

### 2. Triage/Deepen enforcement in dispatcher

SKILL.md dispatcher lists Triage in the phase table but doesn't enforce sequencing. After the Plan gate passes, Triage MUST run before Properties. Add an explicit check: if `current_phase == "plan"` and gate passes, next phase is always Triage (not Properties).

Update SKILL.md dispatcher step 5 to make this sequence non-skippable.

### 3. GitNexus-first tooling in Deepen reference doc

`references/02.8-deepen.md` currently says "search the codebase using `grep_search` or similar tools." Update to mandate GitNexus MCP when available: `gitnexus_context()` for symbol lookups, `gitnexus_query()` for concept search. Use OpenGrep for pattern matching. Fall back to grep only when both are unavailable.

### 4. Branch naming auto-increment

`datum init` always creates `datum/epic-1`. Should auto-detect the next epic number from existing `docs/epics/datum/epic-*` directories or `.datum/runs/`.

## Acceptance Criteria

1. All gate functions resolve artifacts from `docs/epics/<branch>/` with root fallback
2. SKILL.md explicitly enforces Plan → Triage → (Deepen|Properties) sequence
3. `02.8-deepen.md` mandates GitNexus-first, OpenGrep second, grep last
4. `datum init` creates `datum/epic-{N}` where N is the next available number
5. No regressions in existing 45 tests
