"""CheckpointStore — the run-state checkpoint port (ADR-0002/0005/0032).

Local in-memory today; a centralized store (Valkey/Redis) swaps in behind this port for cross-process
resume — selected by URL in the composition root. `core` depends on this Protocol, never a concrete
backend (ADR-0026).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class CheckpointStore(Protocol):
    def save(self, run_id: str, state: dict[str, Any]) -> None: ...

    def get(self, run_id: str) -> dict[str, Any] | None: ...

    def delete(self, run_id: str) -> None: ...
