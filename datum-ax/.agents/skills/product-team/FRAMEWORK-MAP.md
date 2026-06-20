# Product Team — Framework Dispatch Map

The Product Team does **not** reinvent PM method. It **orchestrates** the
[`sam-fakhreddine/product-manager-skills`](https://github.com/sam-fakhreddine/product-manager-skills)
library — 49 battle-tested frameworks — dispatching the right one(s) per lens, per situation. This map
is the integration contract: which frameworks each lens reaches for, and the conventions we adopt so
our skills are native to that library.

> Provenance: distilled directly from the library's `SKILL.md` files (fetched, not guessed).

## Conventions we adopt (from their CLAUDE.md / pm-skill-creator / skill-authoring-workflow)

- **Skill types:** `component` (template/artifact), `interactive` (3–5 adaptive questions, `-advisor`
  suffix), `workflow` (multi-phase orchestration). Our orchestrator = workflow; lenses = interactive.
- **Section anatomy:** Purpose → Key Concepts → Application → Examples → Common Pitfalls → References.
- **Frontmatter:** `name`, `description` (what **and** when, ≤200 chars), plus `intent`, `type`,
  `best-for`.
- **ABC — Always Be Coaching:** explanation is load-bearing, not decorative. Never strip the reasoning,
  anti-patterns, or facilitation detail for brevity (dual audience: humans + agents).
- **Facilitation pattern** (`workshop-facilitation`): entry modes **Guided / Context-dump /
  Best-guess**; **one question per turn** with **numbered options**; visible progress; recommendations
  only at decision points; in best-guess mode, label an **"Assumptions to Validate"** list.

## Lens → framework dispatch

**FRAME (orchestrator)** — adopt `workshop-facilitation` for the whole session; use `lean-ux-canvas`
to frame the *business problem* (not the solution) up front.

**CLARIFY (PM lens)** — pick by what's foggy:
| Need | Framework |
|------|-----------|
| Real problem & assumptions | `problem-framing-canvas`, `problem-statement` |
| What the user is actually trying to do | `jobs-to-be-done` |
| Who it's for (early, hypothesis) | `proto-persona` |
| Outcome → opportunities → solutions (anti feature-factory) | `opportunity-solution-tree` |
| Prep real user conversations | `discovery-interview-prep` (Mom Test style) |
| Friction across the experience | `customer-journey-map` / `-mapping-workshop` |
| Assumption-first framing | `lean-ux-canvas` |

**RESEARCH (researcher lens)** — only the load-bearing unknowns:
| Need | Framework |
|------|-----------|
| Competitor / partner / interview intel | `company-research` (sourced, dated quotes) |
| Macro forces (entering a market) | `pestel-analysis` |
| Is the opportunity big enough | `tam-sam-som-calculator` |
| Business/financial context | `business-health-diagnostic`, `finance-metrics-quickref`, `saas-*-metrics` |

**SKEPTIC (red-team lens)** — pressure-test + force a verdict:
| Need | Framework |
|------|-----------|
| Cheapest test of the riskiest assumption | `pol-probe-advisor` → `pol-probe` ("cheapest prototype → harshest truth", disposable) |
| Frame the bet as falsifiable | `epic-hypothesis` (If/Then + tiny acts of discovery) |
| Does it earn the investment | `feature-investment-advisor` |
| Right prioritization method | `prioritization-advisor` (avoid framework whiplash) |
| **Verdict** | **GO / PIVOT / KILL** (from `discovery-process`) ≙ our **build / spike / do-not-build** |

**SHAPE (synthesis lens)** — produce the validated brief:
| Need | Framework |
|------|-----------|
| Sharp value + differentiation | `positioning-statement` / `positioning-workshop` (Geoffrey Moore) |
| Working-backwards clarity | `press-release` (Amazon; write it as if shipped) |
| Defensible recommendation (AI/high-risk) | `recommendation-canvas` |
| Assumption→experiment one-pager | `lean-ux-canvas`, `epic-hypothesis` |

## Downstream (NOT our remit — the brief routes here)

`prd-development`, `roadmap-planning`, `epic-breakdown-advisor`, `user-story-mapping(-workshop)`,
`user-story(-splitting)`, `storyboard`. These belong to the future **architect/planner** skills the
brief's `recommended_next` points to.

## The smart rule

A lens **selects the framework that fits the situation** — it does not run all of them (tokenomics).
The orchestrator's job is to recognize which fog needs which framework, dispatch it via the
facilitation pattern, and fold the result into the BRIEF.
