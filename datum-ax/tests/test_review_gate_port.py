"""ReviewGate as a plugin: registry + factory (ADR-0032)."""

from __future__ import annotations

import pytest

from datum_ax.contracts.review import DecisionVerdict, ReviewGate
from datum_ax.data.review import REVIEW_GATES
from datum_ax.presentation.composition import build_review_gate


def test_eedom_is_registered_as_a_plugin():
    assert "eedom" in REVIEW_GATES.keys()


def test_build_review_gate_resolves_plugin():
    gate = build_review_gate("eedom")
    assert isinstance(gate, ReviewGate)


def test_build_review_gate_defaults_to_eedom():
    assert isinstance(build_review_gate(), ReviewGate)


def test_unknown_gate_is_a_clear_error():
    with pytest.raises(KeyError):
        build_review_gate("does-not-exist")
