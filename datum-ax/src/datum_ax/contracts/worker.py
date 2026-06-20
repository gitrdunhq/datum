"""Worker (subagent) port (ADR-0035/0032) — runs a playbook skill as an isolated one-shot worker.

The playbook becomes the worker's system prompt; the worker has scoped tools and an isolated window
that is discarded, returning only a typed `WorkerResult`. The worker *reasons* (it may use an LLM +
tools), but its output is evidence for a deterministic gate, never a verdict (ADR-0034).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable

from datum_ax._base import Contract


class WorkerResult(Contract):
    """The compact structured result a worker returns to the orchestrator (ADR-0027)."""

    worker_id: str
    ok: bool
    output: dict[str, Any] = {}


@runtime_checkable
class Worker(Protocol):
    def run(
        self,
        playbook: str,
        inputs: Mapping[str, Any],
        output_schema: Mapping[str, Any] | None = ...,
    ) -> WorkerResult: ...
