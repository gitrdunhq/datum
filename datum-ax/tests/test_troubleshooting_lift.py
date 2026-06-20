"""Troubleshooting lift (ADR-0033): a failed synthesis attempt is a troubleshooting task, so the
crane lifts gitnexus troubleshooting skills into the VARIABLE suffix slot on retry — never the
stable [System] prefix (prompt-cache discipline, ADR-0020). First attempt stays clean."""

from __future__ import annotations

from datum_ax.contracts.inference import Completion, ModelRole
from datum_ax.core.verifier.synthesis import synthesize_impl, synthesize_test
from datum_ax.presentation.composition import build_context_crane


class _RecordingBadClient:
    """Always returns invalid JSON (forces 3 attempts) and records every AssembledPrompt seen."""

    def __init__(self) -> None:
        self.prompts: list = []

    def complete(self, role, prompt, budget, response_format=None):  # noqa: ANN001
        self.prompts.append(prompt)
        return Completion(
            text="not valid json",
            model_id="m",
            role=ModelRole.EXECUTOR,
            input_tokens=1,
            output_tokens=1,
        )


def _run(fn) -> _RecordingBadClient:
    client = _RecordingBadClient()
    fn({"id": "lane_1"}, inference_client=client, crane=build_context_crane())
    return client


def test_first_attempt_prefix_is_clean_no_troubleshooting():
    for fn in (synthesize_test, synthesize_impl):
        client = _run(fn)
        first = client.prompts[0]
        # Stable prefix carries only the role; no gitnexus in prefix OR the (empty) first suffix.
        assert "GitNexus" not in first.system
        assert "GitNexus" not in " ".join(first.suffix)


def test_retry_lifts_troubleshooting_into_the_variable_slot():
    for fn in (synthesize_test, synthesize_impl):
        client = _run(fn)
        assert len(client.prompts) == 3  # initial + 2 retries
        retry_suffixes = " ".join(s for p in client.prompts[1:] for s in p.suffix)
        # Troubleshooting skills (gitnexus-debugging / -bug-hunt) were lifted in on failure.
        assert "GitNexus" in retry_suffixes
        # ...but never into the stable system prefix.
        for p in client.prompts:
            assert "GitNexus" not in p.system


def test_troubleshooting_lifted_once_not_per_retry():
    client = _run(synthesize_test)
    # The skill block appears in the suffix of the retries, but isn't re-stacked every attempt.
    counts = ["## Skill:" in " ".join(p.suffix) for p in client.prompts]
    assert counts.count(True) >= 1
    # No single prompt should contain the troubleshooting block more than once.
    for p in client.prompts:
        assert " ".join(p.suffix).count("# Debugging with GitNexus") <= 1
