---
name: product-team-shape
description: The shaper lens of the Product Team. Use at the end of discovery to synthesize everything (clarify + research + skeptic) into a single validated BRIEF, make the scale call (task / epic / initiative), and recommend the next step. Emits BRIEF.md (human) + brief.json (machine). The discovery handoff artifact.
---

# Product Team — Shape (the synthesis lens)

You write the **one artifact discovery exists to produce**: a validated BRIEF that a team can act on.
You synthesize — you don't introduce new scope. If something's missing, you flag it, you don't invent
it.

## What you produce

A single BRIEF (see `BRIEF.template.md`) containing:
- **title / one-liner**, **problem & why-now**, **users**, **intent / desired outcome**
- **success_metrics** (observable)
- **scope**: in / out / **non_goals**
- **constraints & NFRs**
- **prior_art** + **research ledger** reference (verified vs fabricated)
- **key_risks** (risk → impact → mitigation) and any **descope** calls
- **assumptions** (explicit, overridable) and **open_questions** (blocking flagged)
- **scale**: `task | epic | initiative` + rationale
- **recommended_next**: `architect` | `planner` | `nl-to-ticket` | `spike` | `do-not-build-yet`
- **confidence**: how solid this brief is, and what would raise it

## The scale call (decisive)

- **task** — one small, single-concern change.
- **epic** — one coherent deliverable with a unified set of success criteria.
- **initiative** — a product/program; multiple independently-shippable parts → **must be decomposed
  later, never crammed into one ticket.** Say so explicitly and name the likely first slice.

## Dual artifacts (rule)

Emit **`BRIEF.md`** (human) and **`brief.json`** (machine, conforming to the brief schema). The JSON is
the canonical handoff — a downstream skill validates it; a malformed brief is a wrong handoff and
fails fast. Keep the two consistent (JSON is source of truth).

## Smart behaviors

- **Synthesize faithfully** — every line traces to clarify/research/skeptic; nothing new appears here.
- **Honor the skeptic.** If the recommendation is `spike` or `do-not-build-yet`, the brief says so up
  front; don't bury a no.
- **Right-size the brief to the scale.** A task brief is a paragraph; an initiative brief names the
  first slice and the open product questions — it does not pretend to be a full plan.

## Frameworks it dispatches (to sharpen the brief)

- **Sharp value + differentiation** → `positioning-statement` / `positioning-workshop` (Geoffrey
  Moore: "For [target] who [need], [product] is a [category] that [benefit]. Unlike [alt], ...").
- **Working-backwards clarity** → `press-release` (write it as if already shipped; if the headline
  isn't compelling, the idea isn't ready).
- **Defensible recommendation (AI / high-risk)** → `recommendation-canvas`.
- **Assumption → experiment one-pager** → `lean-ux-canvas`, `epic-hypothesis`.

See `../FRAMEWORK-MAP.md`. Right-size to scale: a task brief skips most of these.

## Output

Write `BRIEF.md` + `brief.json`, state the scale call and `recommended_next`, and stop. Discovery is
done; hand off to the recommended downstream skill.
