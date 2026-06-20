"""ContextAssembler is a first-class, MANDATORY plugin (ADR-0032/0030): the crane sits behind a port
and is resolved from a registry by the composition root — same port+adapter+registry shape as
ReviewGate / PersonaRegistry, but there is always exactly one (no run without an assembler)."""

from __future__ import annotations

import pytest

from datum_ax.contracts.context_assembler import ContextAssembler
from datum_ax.core.orchestration.assemblers import CONTEXT_ASSEMBLERS
from datum_ax.core.orchestration.crane import ContextCrane
from datum_ax.presentation.composition import build_context_crane


def test_crane_is_registered_under_its_key():
    assert "crane" in CONTEXT_ASSEMBLERS.keys()


def test_built_crane_satisfies_the_port_and_is_the_crane():
    crane = build_context_crane()
    assert isinstance(crane, ContextAssembler)  # structural port conformance
    assert isinstance(crane, ContextCrane)  # default adapter


def test_assembler_is_mandatory_unknown_key_raises():
    # No silent fallback — an unknown assembler key is a hard error (mandatory plugin).
    with pytest.raises(KeyError):
        build_context_crane(name="does-not-exist")


def test_resolves_via_registry_by_key():
    crane = build_context_crane(name="crane")
    assert isinstance(crane, ContextAssembler)
