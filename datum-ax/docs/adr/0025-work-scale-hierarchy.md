# ADR-0025: Work-Scale Hierarchy — task / epic / initiative

## Status

Accepted (design)

## Context

The intake skill (ADR-0024) produces a `TICKET.md`. But not every request is one ticket's worth of
work. "Build a tic-tac-toe game" is one epic; "build an autonomous coding pipeline" or "build a CRM"
is a **product = many epics**. If the skill flattens a product into a single ticket, PLAN produces an
unbounded lane DAG, the context window blows (ADR-0022), and the GitHub epic checklist becomes
meaningless. The intake must recognize scale and decompose accordingly.

## Decision

Establish a three-level work-scale hierarchy and make **scale detection the first step of intake**
(ADR-0024, SKILL.md Step 0):

| Scale | Definition | Artifact | Maps to |
|-------|-----------|----------|---------|
| **task** | one small change, single concern | lean `TICKET.md` | a `Patch` / single lane |
| **epic** | one coherent deliverable, unified AC set | `TICKET.md` → one GitHub epic issue + a lane DAG | datum's EPIC |
| **initiative** | a product/program; multiple independently-shippable deliverables | `INITIATIVE.md` decomposing into **epics** | NEW level above EPIC |

Rules:
- **Initiatives decompose, never cram.** An initiative yields an `INITIATIVE.md` listing epics (each
  with intent, rough scope, dependencies, shippability). **Each epic is then run back through
  `nl-to-ticket`** to produce its own `TICKET.md` — the skill is recursive across the hierarchy.
- **Detection signals** (any → initiative): names a product/platform/system; multiple distinct
  user-facing capabilities; a single honest AC list would be unreasonably long or span unrelated
  concerns; parts have different stacks/owners/lifecycles.
- **Sequencing is contract-first across epics too** — the foundation/contract epics come first, the
  same discipline as lanes within an epic (ADR-0010), and the same dogfooded build order
  (ARCHITECTURE "Build order").
- **Initiative ↔ GitHub:** an initiative maps to a **tracking/parent issue** whose children are the
  per-epic issues (each then gets sub-issue lanes, ADR-0023). The `wave:`-style labels apply at the
  epic level too.

## Consequences

- The pipeline can ingest anything from a one-liner to "build me a product" and route it to the right
  granularity instead of choking.
- Recursion keeps one skill responsible for all scales: `initiative → epics → (each) ticket → lanes`.
- An initiative's epic list **is the implementation roadmap** — e.g., running the datum-ax plan itself
  through intake yields the epic-by-epic plan to build datum-ax (see `docs/BUILD-INITIATIVE.md`).
- Adds the term **INITIATIVE** above EPIC in the vocabulary (GLOSSARY).
- Property-test targets: Boundedness (no single TICKET exceeds one-epic scope), Monotonicity (epic
  decomposition never drops a stated capability), Determinism (same product description → same epic
  set).
</content>
