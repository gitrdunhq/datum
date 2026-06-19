# ADR-0022: Context-Budget-Aware Lane Granularity

## Status

Accepted (design)

## Context

ADR-0021 manages the window at runtime by pruning stale/oversized tool outputs. But if a **single
turn** blows the window, pruning is the wrong lens: there may be **nothing stale to prune** — the
bloat is the lane's *own essential context* (the files it must edit, the contract it must satisfy).

A single-turn blowup is therefore a **planning defect, not a memory problem**: PLAN decomposed the
work too coarsely. Prevention at plan time beats mitigation at runtime.

## Decision

**Invariant.** Every lane must be sized so its **essential, un-prunable working set fits comfortably
within the window budget** (ADR-0013): task packet + contract/PROPERTIES + the specific code under
edit + the minimal relevant tests/symbols. (These essentials are exactly what ADR-0021 forbids
pruning.)

- **Plan-time estimation (deterministic, pre-model).** During `plan_dag` (Phase A), estimate each
  lane's context footprint using **Serena** (symbol slices), **TokenSave** (metadata size), and
  **GitNexus** (files touched / blast radius). A lane whose estimated essential footprint exceeds the
  **soft window budget is split further before execution** — splitting at plan time costs zero tokens.
- **Runtime backstop = replan, not prune.** If at dispatch the essential packet still exceeds the cap
  (estimate was wrong, or the generated diff pulled in more), the **pre-dispatch guard (ADR-0021)
  escalates to RE-PLAN / lane-split**, rather than emergency-pruning essentials. The event is recorded
  as a **`lane-plan` triage defect** (datum's triage category).
- **Compounds.** Repeated blowups for a pattern feed the learning loop (ADR-0020): the planner acquires
  a tighter lane-sizing heuristic for that pattern.
- **Don't over-split.** The planner balances lane size against a **minimum-useful-unit**, ROUTE/
  COMPLEXITY-aware (ADR-0018) — atomizing a one-line change adds contract boundaries and coordination
  overhead for nothing.

## Consequences

- Window safety becomes mostly a **planning property, enforced before tokens are spent**; runtime
  pruning (ADR-0021) then only handles accumulated *noise*, never structural oversize.
- Smaller lanes compound benefits: more parallel **waves** (ADR-0015), smaller per-call windows
  (cheaper, no cliff), sharper REFLECT/SKEPTIC focus (ADR-0017), finer disjoint file ownership (ADR-0012).
- Requires a reasonably accurate plan-time footprint estimate; it can be **conservative** (slightly
  over-split) since splitting is cheap and the scheduler recombines independent lanes into waves.
- Adds a replan edge to the loop: a `lane-plan` blowup returns control to Phase A for the affected
  subtree, not the whole run.
- Property-test targets: **Boundedness** (a well-planned lane's essential window is always within
  budget), **Monotonicity** (a lane split never loses contract/PROPERTIES coverage).
</content>
