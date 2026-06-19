"""Dual-artifact support (ADR-0027): every machine artifact has a JSON Schema, and a malformed
handoff is rejected deterministically — markdown is for humans, JSON for machines.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from datum_ax.schemas.ticket import Ticket
from strategies import MODEL_STRATEGIES

_MODELS = list(MODEL_STRATEGIES.keys())
_IDS = [cls.__name__ for cls in _MODELS]


class TestArtifacts:
    @pytest.mark.parametrize("model_cls", _MODELS, ids=_IDS)
    def test_every_artifact_has_a_json_schema(self, model_cls):
        schema = model_cls.model_json_schema()
        assert schema["type"] == "object"
        assert "properties" in schema

    def test_wrong_handoff_is_rejected(self):
        # A machine reading a malformed TICKET artifact fails fast (the handoff is wrong).
        with pytest.raises(ValidationError):
            Ticket.model_validate_json('{"not": "a ticket"}')
