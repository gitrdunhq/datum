"""RuleRegistry port (ADR-0020/0032/0034) — generic, liftable engineering rules.

Rules are reusable guardrails (clean architecture, TDD, …) distinct from domain personas/skills:
the crane lifts them into the `[System]` prefix as scoped steering when a lane needs them. The
artifact is the compound-engineering `RuleRegistryEntry` (schemas/rules.py); a rule's liftable text
is its `statement`. `core` depends on this port; the concrete registry is wired by composition.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from datum_ax.schemas.rules import RuleRegistryEntry


class RuleNotFoundError(LookupError):
    """No rule resolves for the requested id."""


@runtime_checkable
class RuleRegistry(Protocol):
    def get_rule(self, rule_id: str) -> RuleRegistryEntry: ...

    def select_rules(self, scope_tags: tuple[str, ...]) -> tuple[RuleRegistryEntry, ...]: ...

    def match_rules(
        self, query: str, limit: int = ..., threshold: float = ...
    ) -> tuple[RuleRegistryEntry, ...]: ...


@runtime_checkable
class RuleBinder(Protocol):
    """Write side of the rules registry (ADR-0020 capture) — persist learned rules. Kept separate
    from `RuleRegistry` (read side) so a read-only registry need not be writable."""

    def add_rule(self, entry: RuleRegistryEntry) -> None: ...

    def all_rule_ids(self) -> tuple[str, ...]: ...
