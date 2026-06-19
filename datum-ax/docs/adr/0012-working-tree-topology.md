# ADR-0012: Working-Tree Topology & Diff Transport

## Status

Accepted (design)

## Context

With execution on separate hosts, "where does the code live?" must be explicit. If a sandbox held
authoritative state, a crash or escape could corrupt the repo, and resume semantics would be
ambiguous.

A second question this ADR settles: **do we need git worktrees?** datum used per-lane worktrees
because its agent edited files **in place** in a checked-out directory. datum-ax does not edit in
place (diff-in / results-out, below) and isolates execution in containers — so two *different*
isolations must not be conflated:
- **Execution isolation** (running generated code/tests) — provided by ephemeral containers
  (`ExecutionHost`, ADR-0001).
- **Source-state isolation** (parallel lanes' authoritative commits not colliding) — provided by the
  **wave + disjoint-file-ownership** model below.

Worktrees were datum's answer to in-place editing; that need evaporates here.

## Decision

- **One authoritative tree: the EPIC branch on the orchestrator.** There is no per-lane worktree and
  no per-lane branch in the base design.
- **Transport is diff-in / results-out.** A lane attempt ships a **unified diff** to the chosen
  `ExecutionHost`. The host applies it to a **throwaway checkout** built from the current epic HEAD,
  runs tests/lint, and returns **exit code + stderr + a typed report + artifacts** only.
- **Wave-based, conflict-free integration (this is what replaces worktrees):**
  - Waves are scheduled so a lane's `depends_on` are always in *earlier* waves (Kahn, ADR-0015).
  - **Invariant — same-wave lanes are file-disjoint** (the planner guarantees it; ADR-0010/0022). If
    two lanes would touch the same file, they go in different waves.
  - Within a wave, lanes are tested **in parallel containers against the same epic HEAD**; their
    disjoint diffs are **committed to the epic branch at wave close** — conflict-free by construction.
  - The next wave checks out the updated HEAD, so dependency changes (committed by earlier waves) are
    present for downstream lanes (contract-first, ADR-0010).
- **Nothing in a sandbox is authoritative.** The throwaway checkout is discarded on `reset()`
  (ADR-0014). The orchestrator decides what to commit, based on gate results.
- **Pushes happen only at the terminal success state** (ADR-0007), from the orchestrator, and must be
  **idempotent** (LangGraph resume invariant, ADR-0002).
- **Worktrees are optional, not required** — a convenience for a physical per-lane checkout (e.g.
  staging a complex diff) or for parking a suspended lane's WIP during a human `interrupt()`. They are
  an implementation detail, never the isolation mechanism.
- Per-run application **DB** isolation uses the libSQL file-copy/branch pattern (ADR-0005), mirroring
  the throwaway-checkout discipline for data.

## Consequences

- **Containers + disjoint-file waves replace worktrees.** Execution isolation comes from containers;
  source isolation comes from the wave/disjoint-ownership invariant — neither needs per-lane worktrees.
- The blast radius of any sandbox failure is one disposable checkout.
- Resume is well-defined: the epic branch + Valkey checkpoint are the only durable state; replaying a
  sandbox apply is safe because it targets a fresh checkout off epic HEAD.
- The model leans on the planner honoring **same-wave file-disjointness**; a violation would risk a
  merge conflict at wave close, so it is a hard planning invariant, not a soft preference.
- Diff transport keeps the boundary thin and auditable (pairs with secret-isolation, ADR-0011 — only
  diffs/artifacts cross, never credentials).
- Large binary artifacts need a size budget on `collect_artifacts` (ADR-0013).
- Requires robust diff apply with conflict reporting; an un-appliable diff is a failed attempt, not a
  crash. (Reverting to optional per-lane branches is the escape hatch if a project genuinely needs
  non-disjoint same-wave lanes.)
</content>
