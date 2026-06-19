# ADR-0015: Onboarding, Runtime Services & Scheduling

## Status

Accepted (design)

## Context

Before the pipeline can act on a repo it must understand it (index, build/test commands), the context
tools must be running, the network policy must be explicit, and parallel lanes must be scheduled
without overwhelming the single-process oMLX server.

## Decision

- **Repo onboarding.** On first run against a target repo, index it via **Serena + TokenSave**
  (ADR-0004) to build the Global AST/map, **load the versioned rules registry** (ADR-0020) so learned
  gates/steering are in force from the first lane, **read the GitHub epic issue + sub-issues** as the
  primary context (ADR-0023), and **discover test/lint commands**: config-first
  (an explicit `datum-ax` config block per repo) with sensible per-language defaults
  (e.g. `pytest`/`ruff`, `npm test`/`eslint`, `go test`, `cargo test`, `swift test`). Discovery never
  guesses silently — an undiscoverable command surfaces as a setup error, not a skipped gate.
- **MCP server lifecycle.** Serena, Context7, and Headroom.ai run as MCP servers managed by the
  orchestrator (started on demand, health-checked, restarted on failure). They run **orchestrator-side**
  because they shape context — never inside sandboxes.
- **Network policy (explicit).** oMLX inference is **fully local**. Context7 and package registries
  require **egress from the orchestrator side**; sandboxes default to **no egress** (ADR-0011). An
  air-gapped mode disables Context7 and uses only the local code channel.
- **Scheduling / backpressure.** A scheduler runs ready DAG lanes in parallel but throttles against
  the **oMLX semaphore (`max_connections=2`, ADR-0003)** and finite **sandbox capacity**. Backpressure
  (a bounded work queue) ensures concurrent prefill never triggers Apple-Silicon swap; lanes block on
  capacity rather than oversubscribing.

## Consequences

- Onboarding is explicit and reproducible; a repo either has discoverable commands or fails fast.
- Context tooling availability is a managed dependency with health checks, not an assumption.
- The network posture is stated, supporting a sovereign/local-first or air-gapped deployment.
- Lane parallelism is real but bounded by the inference and sandbox ceilings — the scheduler treats
  the semaphore as the governing constraint, not an obstacle.
- Per-language defaults will need maintenance as ecosystems shift; keeping them in config (not code)
  contains that churn.
