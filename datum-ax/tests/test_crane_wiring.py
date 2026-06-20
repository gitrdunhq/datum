"""G1 completion: every prompt build in the planner/verifier routes through the crane — incl. retries."""

from __future__ import annotations

from unittest.mock import MagicMock

from datum_ax.contracts.inference import AssembledPrompt
from datum_ax.core.planner.lane_plan import plan_lanes
from datum_ax.core.planner.triage import triage_ticket
from datum_ax.core.verifier.synthesis import synthesize_impl, synthesize_test


class CountingCrane:
    """Records every assemble() call and returns a real AssembledPrompt."""

    def __init__(self) -> None:
        self.calls = 0

    def compose_system(self, role_id, scope_tags=(), docs=""):  # noqa: ANN001
        # Persona body carries the template token each caller substitutes (ADR-0033).
        return f"SYSTEM[{role_id}] {{{{input}}}} {{{{ticket}}}} {{{{lane_json}}}}"

    def assemble(self, system, global_ast, diff, suffix, budget=None):  # noqa: ANN001
        self.calls += 1
        return AssembledPrompt(
            system=system, global_ast=global_ast, diff=diff, suffix=tuple(suffix)
        )


def _bad_client() -> MagicMock:
    client = MagicMock()
    client.complete.return_value.text = "not valid json"  # forces parse-fail retries
    return client


def test_triage_retries_route_through_crane():
    crane = CountingCrane()
    triage_ticket({"text": "x", "scale": "task"}, inference_client=_bad_client(), crane=crane)
    assert crane.calls >= 2  # initial + at least one retry assembled by the crane


def test_lane_plan_retries_route_through_crane():
    crane = CountingCrane()
    plan_lanes({"text": "x", "scale": "task"}, inference_client=_bad_client(), crane=crane)
    assert crane.calls >= 2


def test_synthesis_retries_route_through_crane():
    crane = CountingCrane()
    synthesize_test({"id": "l1"}, inference_client=_bad_client(), crane=crane)
    synthesize_impl({"id": "l1"}, inference_client=_bad_client(), crane=crane)
    assert crane.calls >= 4  # 2 builds each (initial + retry), both functions
