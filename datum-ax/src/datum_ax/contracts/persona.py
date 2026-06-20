"""Persona contract (ADR-0033) — Roles (who the AI is) and Skills (what it can do) as versioned,
portable artifacts, resolved deterministically behind a port.

The data tier loads artifacts (markdown + frontmatter) and implements ``PersonaRegistry``; the
ContextCrane (core) composes a lane's ``[System]`` prefix from a resolved Role + selected Skills.
Selection is deterministic (by id / model_role / scope_tags) so personas stay off the
determinism/trust-sensitive path; any semantic matching is an opt-in cognition-side adapter.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import Field

from datum_ax._base import Contract
from datum_ax.contracts.inference import ModelRole


class PersonaNotFoundError(LookupError):
    """No artifact resolves for the requested id / model role."""


class Role(Contract):
    """Who the AI is for a step: a versioned system-prompt artifact bound to a model role."""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    model_role: ModelRole
    body: str = Field(min_length=1)
    version: int = Field(default=1, ge=1)
    scope_tags: tuple[str, ...] = ()


class Skill(Contract):
    """What the AI can do: a versioned, packaged capability (instructions + optional tool refs)."""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    instructions: str = Field(min_length=1)
    tool_refs: tuple[str, ...] = ()
    version: int = Field(default=1, ge=1)
    scope_tags: tuple[str, ...] = ()


@runtime_checkable
class PersonaRegistry(Protocol):
    """Port for resolving Roles + Skills (ADR-0033/0032). Deterministic; raises
    ``PersonaNotFoundError`` when an artifact is absent. The concrete registry is injected by the
    composition root; ``core`` depends only on this port."""

    def base_persona(self) -> str: ...

    def get_role(self, role_id: str) -> Role: ...

    def role_for(self, model_role: ModelRole) -> Role: ...

    def get_skill(self, skill_id: str) -> Skill: ...

    def select_skills(self, scope_tags: tuple[str, ...]) -> tuple[Skill, ...]: ...

    def match_skills(
        self, query: str, limit: int = ..., threshold: float = ...
    ) -> tuple[Skill, ...]: ...
