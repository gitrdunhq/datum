"""Typed inference errors (data tier). All failures are typed — no bare exceptions cross a boundary."""

from __future__ import annotations


class InferenceError(Exception):
    """Base for all inference-layer failures."""


class BudgetExceededError(InferenceError):
    """Estimated input exceeds the call's token budget (rejected before dispatch)."""

    def __init__(self, estimated: int, limit: int) -> None:
        self.estimated = estimated
        self.limit = limit
        super().__init__(f"estimated input {estimated} tokens exceeds budget max_input {limit}")


class InferenceTimeoutError(InferenceError):
    """The inference call exceeded its timeout."""


class UnknownRoleError(InferenceError):
    """No RoleConfig is registered for the requested model role."""
