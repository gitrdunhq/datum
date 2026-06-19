"""datum-ax DATA tier — oMLX inference adapter (E2, ADR-0003).

Implements the `contracts.InferenceClient` port: role registry + concurrency semaphore + budget
enforcement over a pluggable transport. `HttpxOmlxTransport` is intentionally NOT re-exported here
(it needs the optional `httpx` extra); import it directly when wiring the real endpoint.
"""

from __future__ import annotations

from datum_ax.data.inference.client import OmlxInferenceClient, default_token_count
from datum_ax.data.inference.errors import (
    BudgetExceededError,
    InferenceError,
    InferenceTimeoutError,
    UnknownRoleError,
)
from datum_ax.data.inference.roles import ModelRoleRegistry, RoleConfig
from datum_ax.data.inference.transport import OmlxTransport
from datum_ax.data.inference.wire import ChatMessage, ChatRequest, ChatResponse, Usage

__all__ = [
    "BudgetExceededError",
    "ChatMessage",
    "ChatRequest",
    "ChatResponse",
    "InferenceError",
    "InferenceTimeoutError",
    "ModelRoleRegistry",
    "OmlxInferenceClient",
    "OmlxTransport",
    "RoleConfig",
    "Usage",
    "UnknownRoleError",
    "default_token_count",
]
