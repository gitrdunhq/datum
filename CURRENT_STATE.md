# Current State

**Last updated:** 2026-05-27
**Epic:** 1 — AIDLC-Inspired Pipeline Enhancements

---

## What shipped

Epic 1 added five structural improvements from AWS AIDLC analysis:

1. **Overconfidence gate** — `gate_plan()` validates `## Assumption Audit` in SPEC.md. Guess-status entries must cross-reference answered questions in QUESTIONS.md. Warns on zero Refine questions.
2. **Adaptive depth classifier** — `datum classify` reads `## Classification Metadata` from SPEC.md, auto-routes to Patch (Express), Feature (Standard), or System (Extended) pipeline.
3. **Units of work** — `lane_plan.py` accepts `{"tasks": [...], "units": {...}}` input with inter-unit dependency validation. System-tier Plan produces unit groupings.
4. **LANDSCAPE.md** — `datum landscape` generates filesystem scaffold (tech stack, LOC, module docstrings). GitNexus enrichment during Discovery.
5. **QUESTIONS.md** — File-based Q&A with `[Answer]:` tags. Generated during Refine, appended during Plan, committed as epic artifact.

Also: `analyze_properties.py` for cross-epic invariant mining, `install_skill.py` path fix, gate path resolution from `docs/epics/<branch>/`.

## Active work

None — main is clean.

## Known issues

- 3 low-severity issues filed: #22 (opaque `_contracts()` indexing), #23 (duplicated render logic in lane_plan.py), #24 (inline-only answer checking in gate)
- 2 pre-existing test failures in `test_datum_hardening.py` from pydantic-core version mismatch in system Python
- Follow-up hardening epic planned: gate path resolution completeness, Deepen enforcement in dispatcher, GitNexus-first tooling in Deepen ref doc

## Architecture notes

- Gates now resolve artifacts from `docs/epics/<branch>/` with root fallback for backward compat
- `datum.contracts` import is lazy in gate.py to avoid pydantic chain in test imports
- SKILL.md mandates explicit `model:` param on every subagent spawn — config tiers are the authority
- SPEC.md template now has 9 sections (added Assumption Audit + Classification Metadata)
