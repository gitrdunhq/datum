"""Generic, liftable rules (ADR-0020/0033/0034). Universal engineering rules (clean architecture,
TDD) live in their own registry behind a port and are lifted into the [System] prefix by the crane
when a lane needs them — extracted out of personas so they're reusable across domains."""

from __future__ import annotations

from datum_ax.contracts.rules import RuleNotFoundError, RuleRegistry
from datum_ax.data.rules import RULE_REGISTRIES
from datum_ax.data.rules.file_registry import FileRuleRegistry
from datum_ax.presentation.composition import _PACKAGED_RULES_ROOT, build_context_crane
from datum_ax.schemas.rules import RuleRegistryEntry

import pytest


def _reg() -> FileRuleRegistry:
    return FileRuleRegistry(root=_PACKAGED_RULES_ROOT)


def test_registry_satisfies_port_and_is_registered():
    assert isinstance(_reg(), RuleRegistry)
    assert "file" in RULE_REGISTRIES.keys()


def test_universal_rules_are_present():
    reg = _reg()
    clean = reg.get_rule("clean-architecture")
    assert isinstance(clean, RuleRegistryEntry)
    assert "inward" in clean.statement.lower()
    assert "universal" in clean.scope_tags
    assert reg.get_rule("tdd-red-first").statement  # the body became the statement


def test_select_rules_by_tag():
    ids = {r.id for r in _reg().select_rules(("code",))}
    assert {"clean-architecture", "tdd-red-first"} <= ids


def test_missing_rule_raises():
    with pytest.raises(RuleNotFoundError):
        _reg().get_rule("nope")


def test_match_rules_deterministic_keyword():
    got = _reg().match_rules("how should I order test and implementation", limit=1)
    assert got and got[0].id == "tdd-red-first"


def test_crane_lifts_code_rules_for_a_code_lane():
    crane = build_context_crane()
    # A code lane lifts the universal code rules into the prefix...
    system = crane.compose_system("green", scope_tags=("code",))
    assert "clean" in system.lower() and "architecture" in system.lower()
    assert "RED" in system  # TDD rule lifted
    # ...a pure-routing lane (no code tag) does not.
    assert "RED" not in crane.compose_system("triage")
