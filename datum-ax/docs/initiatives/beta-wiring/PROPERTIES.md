# PROPERTIES: Beta Wiring

| Property | Domain | Type | Traceability | Evidence Shape |
|----------|--------|------|--------------|----------------|
| The pipeline connects to oMLX. | Network / Transport | LIVENESS | Lane 1 (CLI Wiring) | `datum run` successfully returns an HTTP response from the oMLX server rather than failing locally. |
| Over-budget prompts fail fast. | Inference | SAFETY | Lane 2 (Graph Integration) | Passing an impossibly large ticket to `datum run` throws a `BudgetExceededError` before the network call. |
| The state graph completes end-to-end. | Orchestration | LIVENESS | Lane 2 (Graph Integration) | The state output from `graph.invoke()` contains `["ROUTE", "PhaseA", "PhaseB", "CLOSEOUT"]` in `visited_nodes` and the DAG results. |
| Contracts are respected. | Architecture | INVARIANT | Lanes 1 & 2 | The inference client parsing strictly returns valid Pydantic `Completion` models with correct roles and token counts. |
