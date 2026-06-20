"""Compound engineering — the capture/harvest half (ADR-0020). Run lessons become candidate rules,
tiered (auto-bind vs propose-and-gate), auto-bound rules persist into the registry so the next run's
crane lifts them, and never-fired rules are surfaced for pruning. Deterministic + evidence-backed.

DPS-12: Non-repudiation (every rule carries ≥1 evidence ref), Determinism (same lessons → same
harvest), Idempotency (re-binding the same rule doesn't duplicate it).
"""

from __future__ import annotations


from datum_ax.core.compound.harvest import harvest
from datum_ax.data.rules.file_registry import FileRuleRegistry
from datum_ax.schemas.compound import Lesson, LessonSource
from datum_ax.schemas.rules import RuleKind, RuleTier


def _lesson(**kw) -> Lesson:
    base = dict(
        id="l1",
        source=LessonSource.EEDOM_REJECT,
        statement="Some rule statement.",
        evidence_ref="run-42:eedom:CVE-x",
        proposed_kind=RuleKind.DISCIPLINE,
        scope_tags=("code",),
    )
    base.update(kw)
    return Lesson(**base)


def test_repeated_failure_becomes_an_auto_bound_regression_test():
    res = harvest(
        (_lesson(id="rf", source=LessonSource.REPEATED_FAILURE, proposed_kind=RuleKind.TEST),)
    )
    assert [r.id for r in res.auto_bound] == ["rf"]
    assert res.auto_bound[0].tier is RuleTier.AUTO_BIND
    assert res.proposed == ()


def test_new_discipline_rule_is_proposed_and_gated():
    res = harvest(
        (_lesson(id="nd", source=LessonSource.SKEPTIC_FINDING, proposed_kind=RuleKind.DISCIPLINE),)
    )
    assert [r.id for r in res.proposed] == ["nd"]
    assert res.proposed[0].tier is RuleTier.PROPOSE_AND_GATE
    assert res.auto_bound == ()


def test_cross_kind_tightening_is_proposed_not_autobound():
    # A DISCIPLINE lesson "tightening" an existing rule must NOT silently clobber it auto-bound;
    # only auto-kind (TEST/ROUTING) tightenings auto-bind. (review #11)
    res = harvest(
        (_lesson(id="x", proposed_kind=RuleKind.DISCIPLINE, tightens="clean-architecture"),),
        existing_rule_ids=frozenset({"clean-architecture"}),
    )
    assert [r.id for r in res.proposed] == ["clean-architecture"]
    assert res.auto_bound == ()


def test_auto_kind_tightening_auto_binds():
    res = harvest(
        (_lesson(id="x", proposed_kind=RuleKind.ROUTING, tightens="route-cfg"),),
        existing_rule_ids=frozenset({"route-cfg"}),
    )
    assert [r.id for r in res.auto_bound] == ["route-cfg"]


def test_duplicate_tightening_ids_are_deduped():
    # Two lessons tightening the same id must not emit two colliding auto-bound entries. (review #10)
    res = harvest(
        (
            _lesson(id="l1", proposed_kind=RuleKind.ROUTING, tightens="route-cfg"),
            _lesson(id="l2", proposed_kind=RuleKind.ROUTING, tightens="route-cfg"),
        ),
        existing_rule_ids=frozenset({"route-cfg"}),
    )
    assert [r.id for r in res.auto_bound] == ["route-cfg"]  # one entry, not two


def test_every_harvested_rule_is_evidence_backed():
    res = harvest(
        (_lesson(id="e", source=LessonSource.REPEATED_FAILURE, proposed_kind=RuleKind.TEST),)
    )
    assert res.auto_bound[0].evidence_refs == ("run-42:eedom:CVE-x",)


def test_harvest_is_deterministic():
    lessons = (
        _lesson(id="b", source=LessonSource.ROUTING_SIGNAL, proposed_kind=RuleKind.ROUTING),
        _lesson(id="a", source=LessonSource.ROUTING_SIGNAL, proposed_kind=RuleKind.ROUTING),
    )
    assert [r.id for r in harvest(lessons).auto_bound] == ["a", "b"]


def test_auto_bound_rule_persists_and_reloads(tmp_path):
    reg = FileRuleRegistry(root=str(tmp_path))
    res = harvest(
        (_lesson(id="learned", source=LessonSource.REPEATED_FAILURE, proposed_kind=RuleKind.TEST),)
    )
    for entry in res.auto_bound:
        reg.add_rule(entry)
    # Next run's registry reads the learned rule off disk — the loop compounds.
    reloaded = FileRuleRegistry(root=str(tmp_path))
    assert reloaded.get_rule("learned").statement == "Some rule statement."
    assert "learned" in {r.id for r in reloaded.select_rules(("code",))}


def test_fire_count_and_prune_unfired(tmp_path):
    reg = FileRuleRegistry(root=str(tmp_path))
    reg.add_rule(
        harvest(
            (
                _lesson(
                    id="fires", proposed_kind=RuleKind.ROUTING, source=LessonSource.ROUTING_SIGNAL
                ),
            )
        ).auto_bound[0]
    )
    reg.add_rule(
        harvest(
            (
                _lesson(
                    id="stale", proposed_kind=RuleKind.ROUTING, source=LessonSource.ROUTING_SIGNAL
                ),
            )
        ).auto_bound[0]
    )
    reg.record_fire("fires")
    assert reg.prune_unfired() == ("stale",)  # only the never-fired rule is surfaced
    assert FileRuleRegistry(root=str(tmp_path)).get_rule("fires").fire_count == 1  # persisted
