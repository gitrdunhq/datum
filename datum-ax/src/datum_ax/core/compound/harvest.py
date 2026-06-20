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
    # Tightening an existing rule auto-binds ONLY for safe auto-kinds (test/routing). A tightening of
    # any other kind goes to propose-and-gate so it can't silently clobber a different-kind rule's
    # body wholesale without review (review #11). Bare new lessons follow the kind/source policy.
    if lesson.proposed_kind in _AUTO_KINDS or lesson.source in _AUTO_SOURCES:
        return True
    return False


def harvest(
    lessons: Iterable[Lesson], existing_rule_ids: frozenset[str] = frozenset()
) -> HarvestResult:
    """Split lessons into auto-bound vs proposed candidate rules (deterministic, id-sorted, id-deduped).

    ``existing_rule_ids`` lets a *tightening* lesson target an existing rule by id; tightening only
    auto-binds for auto-kinds (else propose-and-gate). Output is deduplicated by rule id (first wins)
    so two lessons tightening the same id can't emit colliding entries (review #10).
    """
    auto: list[RuleRegistryEntry] = []
    proposed: list[RuleRegistryEntry] = []
    seen: set[str] = set()
    for lesson in sorted(lessons, key=lambda lsn: lsn.id):
        entry = _to_entry(lesson, _is_auto_bind(lesson, existing_rule_ids))
        if entry.id in seen:
            continue  # id already harvested this run — keep the first, drop the duplicate
        seen.add(entry.id)
        (auto if entry.tier is RuleTier.AUTO_BIND else proposed).append(entry)
    return HarvestResult(auto_bound=tuple(auto), proposed=tuple(proposed))


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
