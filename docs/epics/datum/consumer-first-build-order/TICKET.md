# Consumer-first build-order analysis for datum-plan

## What

`datum-plan` decomposes a SPEC into lanes and produces `lane-plan.json` with `depends_on` relationships, but today it infers those relationships purely from the SPEC narrative — never from the actual import graph of the files being built. This causes two failure modes: (1) wrong/missing `depends_on` — parallel lanes that should be sequential, so `datum-tdd-act-lane` agents write against interfaces that don't exist yet (e.g. `vdj-engine.js` written before `vdj-state.js` exists); (2) missing context — `datum-tdd-act-lane` agents only receive the lane spec and SPEC.md, not the source of files they depend on, so they hallucinate upstream interface shapes.

GitHub issue: #264

## Requirements

1. **Build-order analysis sub-step in `datum-plan`**: after reading SPEC.md, before producing `lane-plan.json`, analyze the proposed file list and determine, for each pair (A, B), whether B will import/require A. Apply the consumer-first rule: if B imports A, lane:A must complete before lane:B starts. Encode this into the `depends_on` graph in `lane-plan.json`/`tasks.json`.
2. **Context injection for `datum-tdd-act-lane`**: each lane's act-lane agent must receive the full source of every file in its `depends_on` chain (already-built upstream files), not just the lane spec and SPEC.md — eliminating hallucinated interface shapes.
3. **Config support**: `.datum/config.json` should support a `context_files` array (e.g. `["BUILD-ORDER.md", "ARCHITECTURE.md"]`) — project-declared build-constraint docs injected into `datum-plan`'s prompt so project-specific ordering rules are always respected.

This is a fix to datum's own planning pipeline (`skills/src/datum-plan.ts`, `skills/src/prompts/plan-decompose.md`, `skills/src/datum-tdd-act-lane.ts`, `skills/src/shared/models.ts` config schema) — not an application feature for a downstream consumer project.

## Not This

- Not a full static-analysis/AST import-graph engine across every language datum might ever target — the analysis can be LLM-driven (read proposed files' likely import statements from the SPEC's own file list and descriptions) rather than a mechanical multi-language differ, consistent with how #308/#270/#310 solved similar plan-time gaps this session.
- Not changing how lanes are dispatched/parallelized at Act time beyond respecting the (now more accurate) `depends_on` graph that already exists — this is a plan-time fix, not a new Act-phase scheduler.

