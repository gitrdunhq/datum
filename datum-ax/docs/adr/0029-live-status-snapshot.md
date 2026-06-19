# ADR-0029: Live Status Snapshot — a single JSON of what the pipeline is doing now

## Status

Accepted (design + `LiveStatus` contract built in E1)

## Context

Operators need to see, at a glance, **everything the pipeline is doing at this moment** — current
run/phase, active lanes and their stages, in-flight inference, window occupancy, budget burn, gate
states, pending human interrupts. The libSQL ledger (ADR-0013) holds the *durable history*; this is
the *instantaneous* view. Keep it dead simple to start: **one JSON document.**

## Decision

Define a single typed **`LiveStatus`** contract (`datum_ax.contracts.status`) and expose it:

- **API:** `GET /status` returns the `LiveStatus` JSON (ADR-0028).
- **CLI:** `datum-ax status [--json]` (human render or raw JSON, ADR-0027).

`LiveStatus` aggregates, at `captured_at`:
- run context: `run_id`, `route`, `scale`, `epic`, `phase`, `current_wave`/`waves_total`;
- `lanes`: each active lane's `stage` (RED…EEDOM/DONE/BLOCKED/FAILED), `wave`, `attempt`, `target`;
- `inference`: `active_calls` vs `max_connections` (+ active roles) — bounded by the semaphore;
- `window`: `tokens_in_window` vs `window_target` (occupancy derivable) — the cliff/OOM view;
- `budget`: tokens spent vs ceiling, wall-clock vs ceiling;
- `gates`: name + state (pending/pass/fail/blocking); `pending_interrupts`.

Rules:
- **Single JSON, point-in-time.** No history here (that's the ledger). Cheap to produce and poll.
- **Read-only projection.** The snapshot is assembled by core/data from live state; it is not a
  control surface.
- **Strict contract.** It is a `Contract` (strict/frozen/JSON-Schema), so consumers validate it like
  any handoff (ADR-0027).

## Consequences

- A human or dashboard can poll one endpoint to see live activity; CI/agents branch on the JSON.
- Built now in E1 as the typed contract (`LiveStatus` + sub-models, Hypothesis-tested); the API/CLI
  that serve it land in E10 (ADR-0028), reading from the data/observability layer (E5, ADR-0013).
- Invariants enforced in the type: in-flight calls ≤ capacity (Boundedness); occupancy is a faithful
  function of tokens vs target.
- "For now" = one snapshot; streaming/SSE or per-run detail can extend it later without breaking the
  single-JSON contract.
</content>
