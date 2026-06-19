"""PROPERTIES schema — invariants in eedom's DPS-12 taxonomy (ADR-0016).

Boundary layer (no tier). Pure value objects; the JSON form is the machine artifact, the
rendered Markdown is the human view (ADR-0027).
"""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from datum_ax._base import Contract


class PropertyType(str, Enum):
    """The four formal property types (eedom DPS-12)."""

    SAFETY = "safety"
    LIVENESS = "liveness"
    INVARIANT = "invariant"
    PERFORMANCE = "performance"


class PropertyDomain(str, Enum):
    """The 14 DPS-12 domains (eedom CLAUDE.md taxonomy)."""

    INTEGRITY = "integrity"
    CONFIDENTIALITY = "confidentiality"
    DETERMINISM = "determinism"
    UNIQUENESS = "uniqueness"
    AVAILABILITY = "availability"
    NON_REPUDIATION = "non_repudiation"
    IDEMPOTENCY = "idempotency"
    ATOMICITY = "atomicity"
    MONOTONICITY = "monotonicity"
    ORDERING = "ordering"
    ISOLATION = "isolation"
    BOUNDEDNESS = "boundedness"
    LINEARITY = "linearity"
    REVERSIBILITY = "reversibility"


class Property(Contract):
    """A single testable invariant, traced to the lanes that must satisfy it."""

    id: str = Field(min_length=1)
    domain: PropertyDomain
    type: PropertyType
    statement: str = Field(min_length=1)
    lane_ids: tuple[str, ...] = ()
    evidence_shape: str | None = None
