# Pipeline: Express (Patch Tier)

**Goal:** Ship trivial changes (< 50 LOC, single cluster, no new public API) with minimal ceremony while preserving safety guarantees.

## When Express applies

`datum classify` returns `{"tier": "patch", "pipeline_shape": "express"}`. Criteria:
- `estimated_loc < 50`
- `clusters_touched <= 1`
- `new_public_api = false`

User can override to Standard at the `plan_human_approval` gate.

## Compressed pipeline

Express skips Properties, Architect, and sidecars. It does NOT skip Triage — Triage validates that the Patch classification is correct.

```
Discovery (if stale) → Refine → Classify → Plan → Triage → Act → Validate → PR → Merge → Closeout
```

### What changes vs Standard

| Phase | Standard | Express |
|-------|----------|---------|
| Discovery | Full scan + LANDSCAPE.md | Skip if CURRENT_STATE.md fresh |
| Refine | Full SPEC + QUESTIONS.md | SPEC with Classification Metadata. QUESTIONS.md generated but often empty ("No clarifying questions needed") |
| Classify | Runs | Runs — this is how Express is selected |
| Plan | Full decomposition, architectural approaches | Single task, no approach selection needed. Still requires Assumption Audit (can be minimal — 1 assumption is fine for a patch) |
| Triage | Evaluates rubric | **Still runs.** Validates the Patch classification. Expected result: routes to `properties` (skip Deepen) |
| Deepen | Codebase evidence | Skipped (Triage routes to properties) |
| Properties | 11 categories | **Skipped entirely.** Patch-tier changes are too small for formal property derivation |
| Architect | ADR + C4 | **Skipped.** No architectural decisions in a patch |
| Act | Multi-lane TDD pipeline | **Single lane.** One task, one RED-GREEN-REFACTOR cycle. No skeleton preflight, no adversarial agent, no sidecars |
| Validate | Full suite + GitNexus risk | Full test suite (non-negotiable). GitNexus risk check if available |
| Review | 4-agent swarm | **Single-pass correctness check.** No security/performance/architecture agents — just verify the change matches the SPEC |
| Closeout | Full synthesis | Lightweight: update CURRENT_STATE.md and ROADMAP.md only. No RETRO.md for patches |

### What is NOT skipped

These safety guarantees hold regardless of tier:

1. **Tests must pass.** The full test suite runs at Validate. No exceptions.
2. **Plan gate is required.** Even a one-task plan needs human approval.
3. **Triage runs.** It validates the classification — if the change is actually complex, Triage catches it and routes to Deepen.
4. **Assumption Audit exists.** Can be minimal (1 row), but the section must be present in SPEC.md.
5. **QUESTIONS.md is created.** Even if empty ("No clarifying questions needed"), the file is committed.

## Act phase simplifications

Express Act runs a single lane with the standard RED-GREEN-REFACTOR contract:

- **No skeleton preflight** — single task, agent names its own test functions
- **No adversarial agent** — overkill for < 50 LOC
- **No sidecars** (security, docs) — change is too small to warrant continuous monitoring
- **No parallel lanes** — one task, one lane
- **Retry budget: 2** (not 3) — if a 50-LOC change can't pass in 2 tries, it's probably not a patch

Model tiers still apply: RED/GREEN/REFACTOR use `standard` (Sonnet), not Opus.

## Escape hatch

If at any point during Express the agent realizes the change is larger than expected:

1. Stop the current phase
2. Re-run `datum classify` with updated Classification Metadata
3. If the new tier is Feature or System, switch to the full pipeline from the current phase
4. Log the reclassification in `.datum/state.json`

Do NOT continue Express on a change that should be Feature or System. The classifier's initial read may be wrong — the escape hatch exists for that reason.

## Example Express flow

```
Ticket: "Fix typo in error message — 'authenication' → 'authentication'"

Refine: 1 file, 1 line. Classification: patch. QUESTIONS.md: empty.
Plan: 1 task. Assumption: the string appears once. Confirmed via grep.
Triage: No security, no multi-domain, no deps, no patterns. Routes to properties (skip Deepen).
Properties: Skipped (Patch tier).
Act: RED — test that error message contains "authentication". GREEN — fix the typo. REFACTOR — no-op.
Validate: Full test suite green.
Review: Single-pass — change matches SPEC.
PR → Merge → Closeout (CURRENT_STATE.md only).
```
