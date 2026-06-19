# ADR-0010: Code-Discipline Gates (Contract-First, TDD)

## Status

Accepted (design)

## Context

Development discipline must be **enforced structurally**, not left to the model's good intentions.
datum detects banned patterns but only **warns** and writes the file anyway (advisory lint).
Two disciplines matter most here: **TDD** (a failing test exists before implementation) and
**contract-first / consumer-before-producer** development (no producer code before its contract and
consumer exist).

## Decision

Enforce discipline at two deterministic points in the graph; rules live in config as data
(eedom's "rules as data" philosophy):

- **At PLAN time — contract-first DAG ordering.** The planner topologically orders lanes so
  **contracts/interfaces and their consumers (incl. contract tests) precede producers**. Encoded as
  `depends_on` edges (the same mechanism datum/eedom use for ordering) and validated by a pure-Python
  check **before** Phase B runs. A plan that orders a producer ahead of its contract is rejected at
  planning time — zero execution cost.
- **At verification time — blocking gates inside the loop.** Per lane, in order:
  1. **TDD ordering** — a failing test must exist and run **RED** before a **GREEN** diff is accepted.
  2. **Contract tests** — gate the producer against its consumer's contract.
  3. **Lint/format** — blocking, not advisory (this is the explicit fix to datum's warn-and-write).
  4. **eedom** — the deterministic review gate (ADR-0006).
  A diff that skips RED or implements a producer ahead of its contract is **rejected and routed back**
  to the executor, consuming a loop attempt but **zero extra tokens on the rejection itself**.

## Consequences

- Discipline violations fail fast and deterministically; the model cannot talk its way past them.
- Contract-first ordering means consumers/contract-tests are written first — the same order this very
  deliverable was authored in.
- Rules are inspectable/tunable config, so teams can adjust strictness without code changes.
- Requires a reliable "did a test actually run RED?" signal from `ExecutionHost.run_tests` (a typed
  `TestResult`, not stdout scraping).
- Overly strict contract ordering on trivial tasks adds planning overhead; the planner should apply
  it per-lane, not force a ceremony on single-file changes.
</content>
