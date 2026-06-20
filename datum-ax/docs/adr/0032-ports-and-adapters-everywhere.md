# ADR-0032: Ports & Adapters Everywhere

## Status

Accepted (the governing rule; instances built incrementally)

## Context

We demand that **everything be pluggable** — a clean consumer/producer split with a **defined API and
defined shapes** for every external dependency. We'd been applying this piecemeal (inference,
execution, context, ledger). This ADR makes it the **universal rule** so growth (centralized DB,
hosted Valkey, a different inference runtime, a real eedom container, GitHub) is always a config swap,
never a core rewrite. It strengthens ADR-0026 (three tiers / dependency inversion).

## Decision

**Every external or swappable dependency is a port + adapter, wired at the composition root.**

1. **Port** — a `runtime_checkable` Protocol in `datum_ax.contracts` (the consumer's defined API).
2. **Shapes** — every value crossing the boundary is a strict/frozen Pydantic `Contract` (defined
   shapes; dual-artifact JSON, ADR-0027). No dicts/stringly-typed payloads across a seam.
3. **Adapter(s)** — concrete implementations in `datum_ax.data` (or a skill), one per backend.
4. **Factory** — a `build_*(url|config)` selector in `datum_ax.presentation.composition` chooses the
   adapter by URL scheme / env; unwired backends **fail loudly** (clear seam error).
5. **`core` depends only on ports** (enforced by `tests/test_architecture.py`); concretes are injected
   via `config['configurable']` / constructor.
6. **One conformance suite per port**, parametrized over all adapters → substitutability (Liskov):
   any backend must satisfy the same contract.

### Port inventory

| Port (contracts) | Adapters (data) | Factory |
|------------------|-----------------|---------|
| `InferenceClient` | oMLX (httpx / native MLX) | role registry + `build_inference_client_from_env` |
| `ExecutionHost` | Local / Docker / Tart | (composition) |
| `CodeContext` / `DocContext` / `NlCompressor` / `ContextPruner` | Serena·TokenSave / Context7 / Headroom / DCP | crane DI |
| `RunLedger` | SQLite (`LibSQLLedger`); Postgres/Turso = seam | `build_ledger(url)` (ADR-0031) |
| `CheckpointStore` | `InMemoryCheckpointer`; Valkey/Redis = seam | `build_checkpointer(url)` |
| `ReviewGate` | `EedomReviewGate` (**plugin** via `REVIEW_GATES` registry) | `build_review_gate(name)` |
| `StatusSource` | `StatusProvider` | `build_status_source()` |
| **seams to port next** | GitHub projection → port (when G9 builds it) | — |

**Registry (the plugin mechanism)** lives in `datum_ax/registry.py`: an adapter self-registers a
factory under a key, and the package auto-imports its modules so adding an adapter is a drop-in
(open/closed). `ReviewGate` is the first registry-backed port; the URL-factories (`build_ledger`/
`build_checkpointer`/transports/hosts) migrate to the registry as a consistency pass.

## Extensibility (open/closed) — adding a port is a recipe

The port set is **open**: a new capability is added by *extension*, never by editing existing
ports/adapters/core. To add one:

1. **Port** — add a `runtime_checkable` Protocol to `datum_ax.contracts/<name>.py` (the defined API).
2. **Shapes** — add the strict/frozen Pydantic `Contract`s it exchanges.
3. **Adapter(s)** — implement in `datum_ax.data/...` (or a skill); one per backend.
4. **Factory** — add `build_<name>(url|config)` to `presentation.composition`; default local, remote
   schemes = a loud seam until wired.
5. **Inject** — pass it via `config['configurable']` (or constructor); `core` consumes the port only.
6. **Conformance suite** — add `tests/test_<name>_port.py` parametrized over the adapters.

Existing code is untouched, the boundary test still passes, and the new backend is a config swap.

## Consequences

- Scaling to centralized/multi-user backends = a `DATUM_*_URL` + one adapter; **zero core changes**.
- **Extendable by construction**: features = new ports + adapters; the system grows without churn.
- Uniform testability: fakes for every port; conformance suites guard substitutability.
- New rule for `WORKFLOW.md`: introducing an external dependency means defining its port + shapes +
  factory first.
- Remaining seams (eedom, status, GitHub) are tracked to be brought behind ports (GAP-LEDGER).
</content>
