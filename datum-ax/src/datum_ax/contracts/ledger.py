"""RunLedger — the durable run-trace + token-metering port (ADR-0005/0013/0031).

Local SQLite (`LibSQLLedger`) today; a centralized backend (Postgres/Turso) can be swapped behind this
port without touching `core` — selected by URL in the composition root. `core`/`presentation` depend on
this Protocol, never on a concrete backend (ADR-0026).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class RunLedger(Protocol):
    def record_node(
        self,
        node: str,
        model_id: str | None = ...,
        input_tokens: int | None = ...,
        output_tokens: int | None = ...,
        duration_s: float | None = ...,
        *,
        model_role: str | None = ...,
        attempt: int | None = ...,
        deterministic: bool | None = ...,
        verdict: str | None = ...,
        run_id: str = ...,
    ) -> None: ...

    def get_trace(self, run_id: str | None = ...) -> list[dict[str, Any]]: ...

    def totals(self, run_id: str | None = ...) -> dict[str, int]: ...

    def tokens_spent(self, run_id: str | None = ...) -> int: ...
