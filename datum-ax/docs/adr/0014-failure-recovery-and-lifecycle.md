# ADR-0014: Failure Recovery & Resource Lifecycle

## Status

Accepted (design)

## Context

Autonomous, long-running, multi-host execution leaks resources and loses work unless recovery and
cleanup are designed in. Three things must be guaranteed: no leaked sandboxes/VMs/DB-branches, safe
resume after an orchestrator crash, and correct propagation of lane failure across the DAG.

## Decision

- **Guaranteed teardown.** Every `ExecutionHost.reset()` and per-run libSQL branch deletion runs in a
  `finally`/context-manager path so containers, Tart VMs, and DB copies are reclaimed even on crash or
  budget abort (ADR-0013). Orphan-sweeping on startup catches anything a hard kill missed.
- **Checkpoint-resume.** On orchestrator restart, resume from the Valkey checkpoint (ADR-0002). The
  **re-execution-from-node-start invariant** holds: side effects are idempotent or placed after
  `interrupt()` (sandbox applies target throwaway checkouts; pushes happen only at terminal success).
- **DAG failure propagation.** A failed contract/consumer lane **blocks its dependent producer lanes**
  (via `depends_on`, ADR-0010) — never produce against an unproven contract. Independent lanes
  continue; the run reports partial completion.
- **Terminal human handoff.** When the 3-attempt loop (ADR-0007) is exhausted or a budget trips, the
  graph `interrupt()`s with a serialized, human-readable state (failing diff, last stderr, eedom
  findings via `memo_text`); a human resumes with `Command(resume=...)`.

## Consequences

- No resource leaks across runs, even under crashes — bounded resource usage (eedom property:
  Boundedness/Reversibility).
- Resume is safe because nothing authoritative lives in a sandbox (ADR-0012).
- Partial DAG completion is a first-class outcome, not an error state.
- Human-resume UX (CLI vs dashboard) is intentionally left to a later doc; the `interrupt()` payload
  contract is the stable part.
- Orphan-sweeping must be conservative (only reclaim resources tagged with this pipeline's run IDs) to
  avoid touching unrelated containers on a shared host.
</content>
