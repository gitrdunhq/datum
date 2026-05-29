import pytest
from datum.models.triage_decision_schema import TriageDecision
from pydantic import ValidationError


def test_triage_decision_valid_deepen():
    model = TriageDecision(decision="deepen", reason="multi-file change")
    assert model.decision == "deepen"
    assert model.reason == "multi-file change"


def test_triage_decision_valid_properties():
    model = TriageDecision(decision="properties", reason="simple fix")
    assert model.decision == "properties"
    assert model.reason == "simple fix"


def test_triage_decision_rejects_invalid():
    with pytest.raises(ValidationError):
        TriageDecision(decision="wrong", reason="some reason")


def test_triage_decision_model_dump():
    model = TriageDecision(decision="deepen", reason="x")
    assert model.model_dump() == {"decision": "deepen", "reason": "x"}
