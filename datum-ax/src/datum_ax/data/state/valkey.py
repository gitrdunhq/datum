from typing import Any, Optional


class ValkeyCheckpointer:
    """Adapter for Valkey checkpointer (ADR-0005). 
    Currently stubbed as an in-memory store for the volatile DAG state.
    """
    
    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}

    def save(self, run_id: str, state: dict[str, Any]) -> None:
        self._store[run_id] = state

    def get(self, run_id: str) -> Optional[dict[str, Any]]:
        return self._store.get(run_id)
