"""Rules-registry schema — the compound-engineering learned-rule artifact (ADR-0020).

Every entry is evidence-backed (>=1 evidence ref — Non-repudiation), versioned, and tiered
(auto-bind vs propose-and-gate).
"""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from datum_ax._base import Contract


class RuleTier(str, Enum):
    AUTO_BIND = "auto_bind"
    PROPOSE_AND_GATE = "propose_and_gate"


class RuleKind(str, Enum):
    TEST = "test"
    DISCIPLINE = "discipline"
    OPENGREP = "opengrep"
    EEDOM_POLICY = "eedom_policy"
    PROPERTY = "property"
    STEERING = "steering"
    ROUTING = "routing"


class RuleRegistryEntry(Contract):
    id: str = Field(min_length=1)
    kind: RuleKind
    tier: RuleTier
    statement: str = Field(min_length=1)
    scope_tags: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = Field(min_length=1)
    version: int = Field(ge=1)
    fire_count: int = Field(default=0, ge=0)
