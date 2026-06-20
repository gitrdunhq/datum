from datum_ax.core.verifier.synthesis import synthesize_test, synthesize_impl
from datum_ax.presentation.composition import build_context_crane


class MockInferenceClient:
    def complete(self, prompt, **kwargs):
        from datum_ax.contracts.inference import Completion, ModelRole

        if "test" in str(prompt).lower():
            return Completion(
                text='{"diff": "--- a/test_foo.py\\n+++ b/test_foo.py\\n+def test_foo(): pass"}',
                model_id="mock",
                role=ModelRole.EXECUTOR,
                input_tokens=10,
                output_tokens=10,
            )
        return Completion(
            text='{"diff": "--- a/foo.py\\n+++ b/foo.py\\n+def foo(): pass"}',
            model_id="mock",
            role=ModelRole.EXECUTOR,
            input_tokens=10,
            output_tokens=10,
        )


def test_synthesize_test():
    client = MockInferenceClient()
    lane = {"id": "l1"}
    diff = synthesize_test(lane, inference_client=client, crane=build_context_crane())
    assert "diff" in diff
    assert "+def test_" in diff["diff"]


def test_synthesize_impl():
    client = MockInferenceClient()
    lane = {"id": "l1"}
    diff = synthesize_impl(lane, inference_client=client, crane=build_context_crane())
    assert "diff" in diff
    assert "+def " in diff["diff"]
