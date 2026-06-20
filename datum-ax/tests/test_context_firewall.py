import pytest

from datum_ax.contracts.context import (
    CodeContext,
    ContextPruner,
    DocContext,
    NlCompressor,
)
from datum_ax.contracts.inference import TokenBudget
from datum_ax.core.orchestration.crane import ContextBudgetExceededError, ContextCrane
from datum_ax.data.context.adapters import (
    Context7DocContext,
    HeadroomNlCompressor,
    SerenaTokenSaveContext,
)
from datum_ax.data.context.dcp import DynamicContextPruner


def test_adapters_satisfy_contracts():
    assert isinstance(SerenaTokenSaveContext(), CodeContext)
    assert isinstance(Context7DocContext(), DocContext)
    assert isinstance(HeadroomNlCompressor(), NlCompressor)

    doc = Context7DocContext().library_docs("requests")
    assert "requests" in doc.text

    compressed = HeadroomNlCompressor().compress(
        doc, TokenBudget(max_input=1000, max_output=100, window_target=2000)
    )
    assert "[COMPRESSED]" in compressed.text


def test_pruner_satisfies_protocol():
    # DCP is the single pruner, injected into the crane via the ContextPruner port (ADR-0030).
    assert isinstance(DynamicContextPruner(), ContextPruner)


def test_dcp_prunes_oversized_content():
    pruner = DynamicContextPruner(soft_high_water=0.5, soft_low_water=0.3)
    small_item = "a" * 40
    large_item = "b" * 1200
    suffix = (small_item, large_item, large_item)

    pruned = pruner.prune_suffix(suffix, budget_max=1000, current_total_tokens=610)

    assert any("placeholder_" in s for s in pruned)
    assert "b" * 1200 not in pruned
    assert any(val == large_item for val in pruner.ledger.values())


def _crane(budget: TokenBudget) -> ContextCrane:
    return ContextCrane(
        code_context=SerenaTokenSaveContext(),
        doc_context=Context7DocContext(),
        nl_compressor=HeadroomNlCompressor(),
        pruner=DynamicContextPruner(),
        budget=budget,
    )


def test_crane_is_single_assembler_and_enforces_budget():
    budget = TokenBudget(max_input=100, max_output=100, window_target=200)
    crane = _crane(budget)

    # 10 chunks × 20 tokens = 200; exceeds 100 even after pruning → decompose signal.
    blow = ("a" * 80,) * 10
    with pytest.raises(ContextBudgetExceededError):
        crane.assemble("sys", "ast", "diff", blow)

    # Fits without pruning; stable prefix preserved.
    fit = ("a" * 40,)
    prompt = crane.assemble("sys", "ast", "diff", fit)
    assert prompt.stable_prefix() == "sys\nast\ndiff"
    assert prompt.suffix == fit


def test_crane_essential_footprint_must_fit():
    # The un-prunable prefix alone exceeding the hard limit forces decomposition (ADR-0022).
    budget = TokenBudget(max_input=10, max_output=100, window_target=200)
    crane = _crane(budget)
    with pytest.raises(ContextBudgetExceededError):
        crane.estimate_lane_footprint("x" * 400, "", "")
