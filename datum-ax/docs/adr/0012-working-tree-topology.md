# ADR-0012: Working-Tree Topology & Diff Transport

## Status

Accepted (design)

## Context

With execution on separate hosts, "where does the code live?" must be explicit. If a sandbox held
authoritative state, a crash or escape could corrupt the repo, and resume semantics would be
ambiguous.

## Decision

- **The orchestrator holds the single authoritative git worktree** (per-lane worktrees, as in datum,
  for collision-free parallel lanes).
- **Transport is diff-in / results-out.** A lane attempt ships a **unified diff** to the chosen
  `ExecutionHost`. The host applies it to a **throwaway checkout**, runs tests/lint, and returns
  **exit code + stderr + a typed report + collected artifacts** only.
- **Nothing in a sandbox is authoritative.** The throwaway checkout is discarded on `reset()`
  (ADR-0014). The orchestrator decides what (if anything) to commit, based on gate results.
- **Pushes happen only at the terminal success state** (ADR-0007), from the orchestrator, and must be
  **idempotent** to satisfy the LangGraph resume invariant (ADR-0002).
- Per-run application **DB** isolation uses the libSQL file-copy/branch pattern (ADR-0005), mirroring
  the throwaway-checkout discipline for data.

## Consequences

- The blast radius of any sandbox failure is one disposable checkout.
- Resume is well-defined: the authoritative worktree + Valkey checkpoint are the only durable state to
  recover; replaying a sandbox apply is safe because it targets a fresh checkout.
- Diff transport keeps the boundary thin and auditable (it pairs with the secret-isolation rule in
  ADR-0011 — only diffs/artifacts cross, never credentials).
- Large binary artifacts need a size budget on `collect_artifacts` to avoid bloating the ledger
  (ADR-0013).
- Requires a robust diff apply with conflict reporting; an un-appliable diff is a failed attempt, not
  a crash.
</content>
