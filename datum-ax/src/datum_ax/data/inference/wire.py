"""OpenAI-compatible wire models for oMLX (data tier). Minimal subset of the chat-completions shape.

These are the bytes that cross to oMLX; strict/frozen like every contract.
"""

from __future__ import annotations

from pydantic import Field
from typing import Any

from datum_ax._base import Contract


class ChatMessage(Contract):
    role: str = Field(min_length=1)  # "system" | "user" | "assistant"
    content: str


class Usage(Contract):
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class ChatRequest(Contract):
    model: str = Field(min_length=1)
    messages: tuple[ChatMessage, ...] = Field(min_length=1)
    temperature: float = Field(ge=0, le=2)
    max_tokens: int = Field(gt=0)
    response_format: dict[str, Any] | None = None


class ChatResponse(Contract):
    text: str
    usage: Usage
    finish_reason: str | None = None
