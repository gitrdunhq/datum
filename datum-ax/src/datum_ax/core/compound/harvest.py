"""Harvest run lessons into tiered candidate rules (ADR-0020). Pure + deterministic.

Tiered binding (the user-chosen policy): auto-bind the safe, deterministic, evidence-backed lessons
(a regression test for a fixed bug, tightening an existing rule's params, routing/threshold tuning,
lane-sizing heuristics); propose-and-gate the new/risky ones (new discipline/eedom-policy/property/
steering rules). The capture half of the learning loop; delivery is the rules registry (the crane).
"""

from __future__ import annotations

from collections.abc import Iterable

from datum_ax.schemas.compound import HarvestResult, Lesson, LessonSource
from datum_ax.schemas.rules import RuleKind, RuleRegistryEntry, RuleTier

# Lessons whose *kind* is inherently safe + deterministic → auto-bind.
_AUTO_KINDS = {RuleKind.TEST, RuleKind.ROUTING}
# Lesson sources that map to auto-bindable artifacts (regression test / routing tune / lane sizing).
_AUTO_SOURCES = {
    LessonSource.REPEATED_FAILURE,
    LessonSource.ROUTING_SIGNAL,
    LessonSource.LANE_BLOWUP,
}


def _is_auto_bind(lesson: Lesson, existing_rule_ids: frozenset[str]) -> bool:
    if lesson.tightens and lesson.tightens in existing_rule_ids:
        return True  # tightening an existing rule's params is a safe tweak
    return lesson.proposed_kind in _AUTO_KINDS or lesson.source in _AUTO_SOURCES


def _to_entry(lesson: Lesson, auto: bool) -> RuleRegistryEntry:
    return RuleRegistryEntry(
        id=lesson.tightens or lesson.id,
        kind=lesson.proposed_kind,
        tier=RuleTier.AUTO_BIND if auto else RuleTier.PROPOSE_AND_GATE,
        statement=lesson.statement,
        scope_tags=lesson.scope_tags,
        evidence_refs=(lesson.evidence_ref,),
        version=1,
    )


def harvest(
    lessons: Iterable[Lesson], existing_rule_ids: frozenset[str] = frozenset()
) -> HarvestResult:
    """Split lessons into auto-bound vs proposed candidate rules (deterministic, id-sorted)."""
    auto: list[RuleRegistryEntry] = []
    proposed: list[RuleRegistryEntry] = []
    for lesson in sorted(lessons, key=lambda lsn: lsn.id):
        is_auto = _is_auto_bind(lesson, existing_rule_ids)
        (auto if is_auto else proposed).append(_to_entry(lesson, is_auto))
    return HarvestResult(auto_bound=tuple(auto), proposed=tuple(proposed))
