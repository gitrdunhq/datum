# Current State

**Last updated:** 2026-05-27
**Epic:** 2 — Post-Epic-1 Hardening

---

## What shipped

Epic 1 added five structural improvements from AWS AIDLC analysis:

1. **Overconfidence gate** — `gate_plan()` validates `## Assumption Audit` in SPEC.md. Guess-status entries must cross-reference answered questions in QUESTIONS.md. Warns on zero Refine questions.
2. **Adaptive depth classifier** — `datum classify` reads `## Classification Metadata` from SPEC.md, auto-routes to Patch (Express), Feature (Standard), or System (Extended) pipeline.
3. **Units of work** — `lane_plan.py` accepts `{"tasks": [...], "units": {...}}` input with inter-unit dependency validation. System-tier Plan produces unit groupings.
4. **LANDSCAPE.md** — `datum landscape` generates filesystem scaffold (tech stack, LOC, module docstrings). GitNexus enrichment during Discovery.
5. **QUESTIONS.md** — File-based Q&A with `[Answer]:` tags. Generated during Refine, appended during Plan, committed as epic artifact.

Also: `analyze_properties.py` for cross-epic invariant mining, `install_skill.py` path fix, gate path resolution from `docs/epics/<branch>/`.

Epic 2 fixed four friction points from epic-1:

1. **SSOT path resolution** — `resolve_artifact()` replaces 6 copy-pasted fallback patterns in gate.py
2. **Triage enforcement** — SKILL.md marks Plan→Triage as non-skippable
3. **GitNexus-first Deepen** — 02.8-deepen.md mandates GitNexus→OpenGrep→grep priority
4. **Branch auto-increment** — `next_epic_number()` checks `docs/epics/` alongside `.datum/runs/`
5. **Workflow docs** — Updated mermaid flowchart and phase summary with all epic-1 features

## Active work

None — main is clean.

## Known issues

- 3 low-severity issues filed: #22 (opaque `_contracts()` indexing), #23 (duplicated render logic in lane_plan.py), #24 (inline-only answer checking in gate)
- 2 pre-existing test failures in `test_datum_hardening.py` from pydantic-core version mismatch in system Python
- Express pipeline reference doc (`0x-express.md`) not yet created — currently handled by convention

## Architecture notes

- Gates now resolve artifacts from `docs/epics/<branch>/` with root fallback for backward compat
- `datum.contracts` import is lazy in gate.py to avoid pydantic chain in test imports
- SKILL.md mandates explicit `model:` param on every subagent spawn — config tiers are the authority
- SPEC.md template now has 9 sections (added Assumption Audit + Classification Metadata)
