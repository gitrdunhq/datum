import pytest

from datum_ax.contracts.context import CodeContext, DocContext, NlCompressor, NlDoc
from datum_ax.contracts.inference import TokenBudget
from datum_ax.data.context.adapters import (
    Context7DocContext,
    HeadroomNlCompressor,
    SerenaTokenSaveContext,
)
from datum_ax.data.context.assembler import PromptAssembler
from datum_ax.data.context.dcp import DynamicContextPruner
from datum_ax.data.inference.errors import BudgetExceededError


def test_adapters_satisfy_contracts():
    assert isinstance(SerenaTokenSaveContext(), CodeContext)
    assert isinstance(Context7DocContext(), DocContext)
    assert isinstance(HeadroomNlCompressor(), NlCompressor)

    # Basic functional test
    doc_ctx = Context7DocContext()
    doc = doc_ctx.library_docs("requests")
    assert "requests" in doc.text

    compressor = HeadroomNlCompressor()
    compressed = compressor.compress(doc, TokenBudget(max_input=1000, max_output=100, window_target=2000))
    assert "[COMPRESSED]" in compressed.text


def test_dcp_prunes_oversized_content():
    pruner = DynamicContextPruner(soft_high_water=0.5, soft_low_water=0.3)
    
    # max_input = 1000. high_water = 500. low_water = 300.
    # small suffix string (token count ~ 10, i.e., 40 chars)
    # large suffix string (token count ~ 300, i.e. 1200 chars)
    small_item = "a" * 40
    large_item = "b" * 1200
    
    suffix = (small_item, large_item, large_item)
    # Total tokens ~ 10 + 300 + 300 = 610. Exceeds high water (500).
    
    pruned = pruner.prune_suffix(suffix, budget_max=1000, current_total_tokens=610)
    
    # It should prune the large items to get below low water (300).
    # Pruning one large item removes ~300 tokens, adding a placeholder (~10 tokens).
    # New total ~ 320 tokens. Still above low water? Maybe, so it might prune the second.
    
    assert any("placeholder_" in s for s in pruned)
    assert "b" * 1200 not in pruned  # Or at least one is gone
    
    # Ensure ledger stored the original
    assert any(val == large_item for val in pruner.ledger.values())


def test_assembler_enforces_budget():
    pruner = DynamicContextPruner()
    assembler = PromptAssembler(pruner)
    
    budget = TokenBudget(max_input=100, max_output=100, window_target=200)
    
    system = "sys"
    global_ast = "ast"
    diff = "diff"
    
    # suffix that will definitely blow budget even with pruning 
    # (since DCP might not prune small chunks or might leave placeholders that sum up to > budget)
    # We use a single fat chunk that even when replaced by a placeholder fits?
    # Wait, let's just use many small chunks that don't get pruned but exceed budget
    suffix = ("a" * 80,) * 10  # 10 chunks of 20 tokens = 200 tokens. 
    # DCP doesn't prune chunks < 20 tokens. So these won't be pruned.
    
    with pytest.raises(BudgetExceededError):
        assembler.assemble(system, global_ast, diff, suffix, budget)

    # Fits
    suffix_fit = ("a" * 40,)
    prompt = assembler.assemble(system, global_ast, diff, suffix_fit, budget)
    
    assert prompt.stable_prefix() == "sys\nast\ndiff"
    assert prompt.suffix == suffix_fit
