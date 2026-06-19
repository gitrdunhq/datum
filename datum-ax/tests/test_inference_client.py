"""E2 acceptance: OmlxInferenceClient against a mock oMLX transport (no network)."""

from __future__ import annotations

import asyncio

import pytest

from datum_ax.contracts.inference import (
    AssembledPrompt,
    Completion,
    InferenceClient,
    ModelRole,
    TokenBudget,
)
from datum_ax.data.inference import (
    BudgetExceededError,
    InferenceTimeoutError,
    ModelRoleRegistry,
    OmlxInferenceClient,
    RoleConfig,
    UnknownRoleError,
)
from fakes import FakeOmlxTransport


def _registry() -> ModelRoleRegistry:
    return ModelRoleRegistry(
        configs=(
            RoleConfig(role=ModelRole.TRIAGE, model_id="triage-m", temperature=0.0),
            RoleConfig(role=ModelRole.EXECUTOR, model_id="exec-m", temperature=0.2),
            RoleConfig(role=ModelRole.ADVERSARIAL, model_id="adv-m", temperature=0.7),
        )
    )


def _prompt(suffix: tuple[str, ...] = ()) -> AssembledPrompt:
    return AssembledPrompt(system="sys", global_ast="ast", diff="diff", suffix=suffix)


def _budget(max_input: int = 1000, max_output: int = 256, window: int = 2000) -> TokenBudget:
    return TokenBudget(max_input=max_input, max_output=max_output, window_target=window)


class TestInferenceClient:
    def test_returns_typed_completion(self):
        t = FakeOmlxTransport(reply="hello", input_tokens=12, output_tokens=3)
        client = OmlxInferenceClient(t, _registry())
        out = asyncio.run(client.complete(ModelRole.EXECUTOR, _prompt(), _budget()))
        assert isinstance(out, Completion)
        assert out.text == "hello"
        assert out.model_id == "exec-m"
        assert out.role is ModelRole.EXECUTOR
        assert out.input_tokens == 12 and out.output_tokens == 3
        # the request carried the role's temperature and the budget's max_output
        assert t.calls[0].model == "exec-m"
        assert t.calls[0].temperature == 0.2
        assert t.calls[0].max_tokens == 256

    def test_satisfies_inference_client_protocol(self):
        client = OmlxInferenceClient(FakeOmlxTransport(), _registry())
        assert isinstance(client, InferenceClient)

    def test_semaphore_caps_concurrency(self):
        t = FakeOmlxTransport(delay=0.02)
        client = OmlxInferenceClient(t, _registry(), max_connections=2)

        async def run_many() -> list[Completion]:
            return await asyncio.gather(
                *[client.complete(ModelRole.TRIAGE, _prompt(), _budget()) for _ in range(8)]
            )

        outs = asyncio.run(run_many())
        assert len(outs) == 8
        assert t.peak <= 2  # the invariant: never exceed the cap
        assert t.peak == 2  # and under load it actually parallelizes up to the cap

    def test_over_budget_rejected_without_dispatch(self):
        t = FakeOmlxTransport()
        client = OmlxInferenceClient(t, _registry(), token_counter=lambda s: 10_000)
        with pytest.raises(BudgetExceededError):
            asyncio.run(client.complete(ModelRole.EXECUTOR, _prompt(), _budget(max_input=100)))
        assert t.calls == []  # transport never called

    def test_timeout_raises(self):
        t = FakeOmlxTransport(delay=0.05)
        client = OmlxInferenceClient(t, _registry(), timeout_s=0.01)
        with pytest.raises(InferenceTimeoutError):
            asyncio.run(client.complete(ModelRole.TRIAGE, _prompt(), _budget()))

    def test_unknown_role_raises(self):
        reg = ModelRoleRegistry(
            configs=(RoleConfig(role=ModelRole.TRIAGE, model_id="m", temperature=0.0),)
        )
        with pytest.raises(UnknownRoleError):
            reg.get(ModelRole.EXECUTOR)

    def test_rejects_zero_connections(self):
        with pytest.raises(ValueError):
            OmlxInferenceClient(FakeOmlxTransport(), _registry(), max_connections=0)
