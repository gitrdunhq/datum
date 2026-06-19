# ADR-0001: Asymmetric Compute Topology & the `ExecutionHost` Interface

## Status

Accepted (design)

## Context

The pipeline runs model-generated code. Running that code on the same Apple-Silicon box that hosts
inference is dangerous on two axes: **safety** (untrusted code next to secrets and the authoritative
worktree) and **performance** (test/build workloads contend with oMLX for unified memory, triggering
swap during prefill). The source blueprint prescribes three physical nodes. For a single developer
that is often more than necessary, but the *logical* separation is essential.

## Decision

Separate **cognition** from **execution** logically, and express all execution behind a single
`ExecutionHost` interface so the physical topology is a deployment choice.

- **Node 0 — Orchestrator (Apple Silicon):** LangGraph + oMLX + context firewall + the authoritative
  git worktree. **Never executes model-generated code.** Holds all secrets.
- **Node 1 — x86 Linux sandbox (primary):** ephemeral Docker/Podman, native x86 (no QEMU).
- **Node 2 — macOS sandbox (optional):** Tart VM or SSH for Darwin/Swift targets. v1 = interface + stub.

`ExecutionHost` (see `ARCHITECTURE.md` §3.1) exposes `apply_diff`, `run_tests`, `run_lint`,
`collect_artifacts`, `reset`. Implementations: `X86DockerHost` (concrete v1), `MacOSTartHost` (stub).
The deterministic triage node (ADR-0002 Phase A) selects the host; nothing else in the graph knows
which host it is talking to.

Physical collapse is allowed: Nodes 0/1 may be two machines, or the x86 sandbox may be a local VM —
the interface is unchanged.

## Consequences

- Generated code never touches the orchestrator's memory, secrets, or authoritative worktree.
- Adding macOS (or a remote cloud sandbox) later is a new `ExecutionHost`, not a redesign.
- The triage node must produce a typed target enum (`x86 | macos`); see ADR-0002.
- Diff-in/results-out is the only data crossing the boundary (ADR-0012); no credentials cross it
  (ADR-0011).
- v1 with x86-only is fully functional for general multi-language targets; Swift support is gated on
  implementing `MacOSTartHost`.
