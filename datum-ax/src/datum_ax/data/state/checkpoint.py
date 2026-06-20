"""Checkpoint adapters (ADR-0002/0005/0032). Implements the `CheckpointStore` port.

`InMemoryCheckpointer` is the local default (resume within a process). A real Valkey/Redis adapter is
the swap point for cross-process / multi-worker resume, wired by `build_checkpointer` in the
composition root.
"""

from __future__ import annotations

from typing import Any


class InMemoryCheckpointer:
    """In-process checkpoint store. Resume = a saved run state is retrievable (idempotent replay)."""

    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}

    def save(self, run_id: str, state: dict[str, Any]) -> None:
        self._store[run_id] = dict(state)

    def get(self, run_id: str) -> dict[str, Any] | None:
        snapshot = self._store.get(run_id)
        return dict(snapshot) if snapshot is not None else None

    def delete(self, run_id: str) -> None:
        self._store.pop(run_id, None)
