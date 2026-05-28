# Model Tiers

DATUM uses abstract tiers, never raw model IDs. The host tool resolves tiers to its own models.

## Tiers

| Tier | Use for | Examples |
|---|---|---|
| **reasoning** | Ambiguity, architecture, synthesis, adversarial | Opus, o3, Gemini 2.5 Pro |
| **standard** | Coding, review, evidence gathering | Sonnet, GPT-5.4, Gemini 2.5 Pro |
| **fast** | Scaffolding, validation, docs, scoped execution | Haiku, o4-mini, Gemini 2.5 Flash |

## Config

Map tiers to model IDs in `.datum/config.toml`:

```toml
[models]
reasoning = "claude-opus-4-7"      # or "o3", "gemini-2.5-pro"
standard  = "claude-sonnet-4-6"    # or "gpt-5.4", "gemini-2.5-pro"
fast      = "claude-haiku-4-5-20251001"  # or "o4-mini", "gemini-2.5-flash"
```

One model available? Set all three to it.

## Phase Assignments

| Phase | Tier | Why |
|---|---|---|
| Discovery | reasoning | Exploratory, domain mapping |
| Refine | reasoning | Ambiguity resolution |
| Plan | reasoning | Architectural decomposition |
| Triage | fast | 4-criteria boolean rubric |
| Deepen | standard | Codebase evidence search |
| Properties | reasoning | Formal property derivation |
| Architect | reasoning | ADR evaluation |
| ACT — Skeleton | fast | Mechanical scaffolding |
| ACT — RED | standard (fast if deepened) | Write failing tests |
| ACT — GREEN | standard (fast if deepened) | Make tests pass |
| ACT — REFACTOR | standard (fast if deepened) | Cleanup + proof-of-work |
| ACT — Adversarial | reasoning | Edge-case discovery |
| datum-security sidecar | standard | STRIDE + secrets scan |
| datum-docs sidecar | fast | Inline docs |
| Validate | fast | Run tests, report |
| Review | reasoning | Multi-domain judgment |
| PR Comments triage | reasoning | Classify feedback |
| PR Comments fix | standard | Address findings |
| Closeout collectors | fast | Data gathering |
| Closeout synthesis | reasoning | Retro narrative |

## Deepen Downshift

When Triage routes through Deepen, RED/GREEN/REFACTOR drop from standard to fast. Deepen appends codebase evidence to TASKS.md — patterns, conventions, pitfalls — so the brief already contains what a standard model would discover. Fast can execute it.

```toml
[pipeline]
deepen_downshift = true
```

Adversarial stays reasoning. Retry escalation still works (attempt 2+ → standard → reasoning).

When Triage skips Deepen, coding tiers stay standard.

## Retry Escalation

```
Attempt 1: standard (same brief, new agent)
Attempt 2: reasoning (rewritten brief + diagnostics)
Attempt 3: reasoning (verbose + failure context)
```

Environmental failures: fix in place, same tier, counter not incremented.

## Load Leveling

```toml
[pipeline.load_leveling]
max_reasoning_tier_concurrent = 2
max_standard_tier_concurrent  = 5
```

## Override

```toml
[models.phases]
act_refactor = "reasoning"   # this repo needs deeper refactoring
review       = "standard"    # save cost
```
