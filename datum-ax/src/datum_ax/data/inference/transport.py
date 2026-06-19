"""Transport port (data tier) — the thin seam to an OpenAI-compatible endpoint (oMLX) or a fake.

The InferenceClient owns role lookup, the semaphore, and budget enforcement; the transport only
performs one request/response. Swap a fake for tests, httpx for real (ADR-0026 dependency inversion).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from datum_ax.data.inference.wire import ChatRequest, ChatResponse


@runtime_checkable
class OmlxTransport(Protocol):
    async def complete(self, request: ChatRequest) -> ChatResponse: ...
