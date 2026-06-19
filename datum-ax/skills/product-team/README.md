# Product Team — discovery & shaping skill suite

A virtual **senior product team** for the *fuzzy front end*. Give it a raw idea (a one-liner or a
messy brain-dump); it clarifies, researches, pressure-tests, and **shapes a validated brief + a scale
call** — then hands off. It deliberately stops **before** architecture and decomposition.

> Remit: **discovery + shaping only.** Form: **orchestrator + sub-skills.**

## The suite

| Skill | Lens | Role |
|-------|------|------|
| [`product-team`](SKILL.md) | conductor | runs the discovery flow, picks phases/depth, owns the BRIEF |
| [`product-team-clarify`](clarify/SKILL.md) | Product Manager | intent, users, problem, success metrics, scope boundaries |
| [`product-team-research`](research/SKILL.md) | Researcher | facts + prior art, with a verified/fabricated ledger |
| [`product-team-skeptic`](skeptic/SKILL.md) | Red-team | risks, failure modes, over-engineering, build/spike/no-build |
| [`product-team-shape`](shape/SKILL.md) | Shaper | the validated BRIEF + scale call + handoff recommendation |

## Flow

```
raw idea
  → FRAME (one sentence, gauge richness/scale/stakes)
  → CLARIFY  (highest-leverage questions, lock answers)
  → RESEARCH (load-bearing unknowns → ledger)
  → SKEPTIC  (pressure-test → build / spike / don't-build)
  → SHAPE    → BRIEF.md + brief.json  (+ scale call + recommended_next)
  → handoff (architect | planner | nl-to-ticket | spike | do-not-build-yet)
```

## Artifacts

- [`BRIEF.template.md`](BRIEF.template.md) — the discovery handoff (md for humans, `brief.json` for
  machines; JSON is the canonical, validatable contract).
- [`RESEARCH-LEDGER.template.md`](RESEARCH-LEDGER.template.md) — verified vs fabricated facts.

## Principles

Adaptive depth (tokenomics) · one decision at a time · faithful not inventive · honest dissent ·
skeptical research · scale-aware · dual artifacts · knows when to stop. A discovery that ends in a
well-reasoned **"don't build this yet"** is a success.

## Where it sits

Upstream of everything else. When discovery recommends building, the BRIEF feeds the build pipeline's
intake (`../nl-to-ticket`) or an architect/planner skill. The Product Team does **not** design or
decompose — it makes sure the *right* thing gets built, clearly understood, before any of that starts.

**Downstream (not in this remit, invoked later):** `architect` (design + ADRs), `planner` (epics →
lanes). These are future sub-skills the brief routes to.
</content>
