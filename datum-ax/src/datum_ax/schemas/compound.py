"""Compound-engineering capture schema (ADR-0020) — a run lesson and the harvest result.

A `Lesson` is an evidence-backed observation from a run (an eedom reject, a repeated failure, a
SKEPTIC finding, a lane blowup, a routing signal). `harvest` turns lessons into tiered candidate
rules (`RuleRegistryEntry`): auto-bind the safe deterministic ones, propose-and-gate the rest.
"""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from datum_ax._base import Contract
from datum_ax.schemas.rules import RuleKind, RuleRegistryEntry


class LessonSource(str, Enum):
    EEDOM_REJECT = "eedom_reject"
    REPEATED_FAILURE = "repeated_failure"
    SKEPTIC_FINDING = "skeptic_finding"
    LANE_BLOWUP = "lane_blowup"
    ROUTING_SIGNAL = "routing_signal"


class Lesson(Contract):
    """An evidence-backed observation harvested from a run (Non-repudiation: evidence_ref required)."""

    id: str = Field(min_length=1)
    source: LessonSource
    statement: str = Field(min_length=1)
    evidence_ref: str = Field(min_length=1)
    proposed_kind: RuleKind
    scope_tags: tuple[str, ...] = ()
    tightens: str | None = None  # id of an existing rule this lesson tightens (a safe param tweak)


class HarvestResult(Contract):
    """The split: rules safe to auto-bind vs rules surfaced for a human yes/no (ADR-0020)."""

    auto_bound: tuple[RuleRegistryEntry, ...] = ()
    proposed: tuple[RuleRegistryEntry, ...] = ()
