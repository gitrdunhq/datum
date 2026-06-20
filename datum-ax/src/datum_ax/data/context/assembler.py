from datum_ax.contracts.inference import AssembledPrompt, TokenBudget
from datum_ax.data.context.dcp import DynamicContextPruner
from datum_ax.data.inference.errors import BudgetExceededError


class PromptAssembler:
    """Assembles the task packet, keeping the prefix stable and pruning the suffix (ADR-0004/0021)."""

    def __init__(self, pruner: DynamicContextPruner):
        self.pruner = pruner

    def _estimate_tokens(self, text: str) -> int:
        return len(text) // 4  # heuristic

    def assemble(
        self, system: str, global_ast: str, diff: str, suffix: tuple[str, ...], budget: TokenBudget
    ) -> AssembledPrompt:
        prefix_tokens = (
            self._estimate_tokens(system)
            + self._estimate_tokens(global_ast)
            + self._estimate_tokens(diff)
        )
        suffix_tokens = sum(self._estimate_tokens(t) for t in suffix)
        total_tokens = prefix_tokens + suffix_tokens

        # Attempt to prune if needed
        pruned_suffix = self.pruner.prune_suffix(suffix, budget.max_input, total_tokens)
        new_suffix_tokens = sum(self._estimate_tokens(t) for t in pruned_suffix)
        new_total_tokens = prefix_tokens + new_suffix_tokens

        if new_total_tokens > budget.max_input:
            raise BudgetExceededError(estimated=new_total_tokens, limit=budget.max_input)

        return AssembledPrompt(
            system=system,
            global_ast=global_ast,
            diff=diff,
            suffix=pruned_suffix,
        )
