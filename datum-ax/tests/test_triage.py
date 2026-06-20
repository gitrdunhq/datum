from datum_ax.core.planner.triage import triage_ticket
from datum_ax.presentation.composition import build_context_crane


def test_triage_ticket_with_inference():
    class MockInferenceClient:
        def complete(self, prompt, **kwargs):
            from datum_ax.contracts.inference import Completion, ModelRole

            return Completion(
                text='{"target": "ui", "route": "feature"}',
                model_id="mock",
                role=ModelRole.TRIAGE,
                input_tokens=10,
                output_tokens=10,
            )

    client = MockInferenceClient()
    ticket = {"text": "fix a small bug in ui", "scale": "task"}
    result = triage_ticket(ticket, inference_client=client, crane=build_context_crane())

    assert result["target"] == "ui"
    assert result["route"] == "feature"
