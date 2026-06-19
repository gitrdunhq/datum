"""InferenceClient contract (ADR-0003/0009) — the core<->data seam for oMLX inference, by role.
All calls pass a TokenBudget; the AssembledPrompt fixes the cache-stable prefix.
"""

from __future__ import annotations

from enum import Enum
from typing import Protocol, runtime_checkable

from pydantic import Field, model_validator

from datum_ax._base import Contract


class ModelRole(str, Enum):
    TRIAGE = "triage"
    EXECUTOR = "executor"
    ADVERSARIAL = "adversarial"


class TokenBudget(Contract):
    """Boundedness: the prompt input must fit inside the window target (ADR-0013)."""

    max_input: int = Field(gt=0)
    max_output: int = Field(gt=0)
    window_target: int = Field(gt=0)

    @model_validator(mode="after")
    def _input_fits_window(self) -> "TokenBudget":
        if self.max_input > self.window_target:
            raise ValueError("max_input exceeds window_target (Boundedness violation)")
        return self


class AssembledPrompt(Contract):
    """The Task Packet. Stable prefix = system + global_ast + diff (ADR-0003/0004); the variable
    suffix is prunable (DCP, ADR-0021).
    """

    system: str
    global_ast: str
    diff: str
    suffix: tuple[str, ...] = ()

    def stable_prefix(self) -> str:
        """The byte-stable prefix oMLX caches across lanes."""
        return "\n".join((self.system, self.global_ast, self.diff))


class Completion(Contract):
    text: str
    model_id: str = Field(min_length=1)
    role: ModelRole
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    finish_reason: str | None = None


@runtime_checkable
class InferenceClient(Protocol):
    """Port for the oMLX-backed inference layer (data tier), throttled by a semaphore."""

    async def complete(
        self, role: ModelRole, prompt: AssembledPrompt, budget: TokenBudget
    ) -> Completion: ...
