"""FakeWorker — deterministic stand-in for the subagent harness (ADR-0035).

No model, no tools: it echoes the inputs as a structured result so the seam (port + contract +
isolation semantics) is exercisable in CI. The real worker — a tool-calling loop over the GitNexus
MCP + oMLX with canary-first spawning — is a hardware-gated adapter behind the same `Worker` port.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from datum_ax.contracts.worker import WorkerResult
from datum_ax.data.workers import WORKERS


class FakeWorker:
    """Implements the `Worker` port deterministically."""

    def __init__(self, **_config: Any) -> None:
        # Accepts (and ignores) config kwargs for drop-in parity with the real adapter.
        pass

    def run(
        self,
        playbook: str,
        inputs: Mapping[str, Any],
        output_schema: Mapping[str, Any] | None = None,
    ) -> WorkerResult:
        return WorkerResult(worker_id="fake", ok=True, output=dict(inputs))


@WORKERS.register("fake")
def _build(**kwargs: Any) -> FakeWorker:
    return FakeWorker(**kwargs)
