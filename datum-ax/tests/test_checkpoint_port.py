"""Checkpointer behind a swappable port + resume (ADR-0032)."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from datum_ax.contracts.checkpoint import CheckpointStore
from datum_ax.data.state.checkpoint import InMemoryCheckpointer
from datum_ax.presentation.composition import build_checkpointer


def _mem_factory() -> CheckpointStore:
    return InMemoryCheckpointer()


CHECKPOINTER_FACTORIES = [_mem_factory]  # add a real Valkey factory here when wired


class TestCheckpointPort:
    def test_inmemory_satisfies_port(self):
        assert isinstance(InMemoryCheckpointer(), CheckpointStore)

    def test_build_checkpointer_defaults_to_memory(self):
        cp = build_checkpointer()
        assert isinstance(cp, CheckpointStore)

    def test_centralized_backend_is_a_clear_seam(self):
        with pytest.raises(NotImplementedError):
            build_checkpointer("valkey://host:6379")

    def test_resume_roundtrip_and_isolation(self):
        cp = build_checkpointer("memory://")
        cp.save("r1", {"stage": "plan", "wave": 0})
        cp.save("r2", {"stage": "act"})
        # resume = saved state is retrievable (idempotent replay)
        assert cp.get("r1") == {"stage": "plan", "wave": 0}
        assert cp.get("r2") == {"stage": "act"}  # isolation: runs don't collide
        assert cp.get("missing") is None
        cp.delete("r1")
        assert cp.get("r1") is None

    @pytest.mark.parametrize("factory", CHECKPOINTER_FACTORIES)
    def test_port_conformance(self, factory):
        cp = factory()
        assert isinstance(cp, CheckpointStore)
        cp.save("r", {"k": 1})
        assert cp.get("r") == {"k": 1}


class TestCheckpointProperties:
    @given(state=st.dictionaries(st.text(max_size=8), st.integers(), max_size=6))
    def test_idempotent_save_then_get(self, state):
        # Idempotency: saving the same state (once or twice) yields the same retrievable state.
        cp = InMemoryCheckpointer()
        cp.save("r", state)
        cp.save("r", state)
        assert cp.get("r") == state
