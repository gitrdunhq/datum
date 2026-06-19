"""Generic property tests over every boundary model (ADR-0026/0027).

TestProperties — Determinism (INVARIANT) and Integrity (SAFETY).
"""

from __future__ import annotations

import json

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from strategies import MODEL_STRATEGIES

_PARAMS = list(MODEL_STRATEGIES.items())
_IDS = [cls.__name__ for cls in MODEL_STRATEGIES]


class TestProperties:
    """Domain: Determinism + Integrity. Holds for every model that crosses a tier boundary."""

    @pytest.mark.parametrize("model_cls, strat", _PARAMS, ids=_IDS)
    @given(data=st.data())
    def test_determinism_json_roundtrip(self, model_cls, strat, data):
        # INVARIANT / Determinism: the machine JSON artifact round-trips losslessly.
        m = data.draw(strat)
        assert model_cls.model_validate_json(m.model_dump_json()) == m

    @pytest.mark.parametrize("model_cls, strat", _PARAMS, ids=_IDS)
    @given(data=st.data())
    def test_integrity_rejects_unknown_fields(self, model_cls, strat, data):
        # SAFETY / Integrity: a tampered/extended artifact never validates (extra="forbid").
        m = data.draw(strat)
        payload = json.loads(m.model_dump_json())
        payload["__unexpected__"] = "x"
        with pytest.raises(ValidationError):
            model_cls.model_validate_json(json.dumps(payload))

    @pytest.mark.parametrize("model_cls, strat", _PARAMS, ids=_IDS)
    @given(data=st.data())
    def test_integrity_is_immutable(self, model_cls, strat, data):
        # SAFETY / Integrity: contracts are frozen — no post-hoc mutation.
        m = data.draw(strat)
        field = next(iter(model_cls.model_fields))
        with pytest.raises(ValidationError):
            setattr(m, field, getattr(m, field))
