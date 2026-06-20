"""ContextCrane — the single source of truth for context assembly (ADR-0030).

Owns the whole window: the Context Firewall (ADR-0004), Dynamic Context Pruning (ADR-0021), and
Budget-Aware Lane Granularity (ADR-0022). One assembly path: hoist -> assemble -> prune ->
budget-check, with cross-payload symbol dedup. Depends only on contract Protocols (ADR-0026); the
data adapters (code/doc/compressor/pruner) and the token counter are injected.
"""

from __future__ import annotations

import json
from typing import Any

from datum_ax.contracts.context import CodeContext, ContextPruner, DocContext, NlCompressor
from datum_ax.contracts.inference import AssembledPrompt, TokenBudget
from datum_ax.contracts.tokens import TokenCounter, default_token_count


class ContextBudgetExceededError(Exception):
    """The essential, un-prunable payload exceeds the hard limit — the planner must decompose the
    lane (ADR-0022)."""


class ContextCrane:
    def __init__(
        self,
        code_context: CodeContext,
        doc_context: DocContext,
        nl_compressor: NlCompressor,
        pruner: ContextPruner,
        budget: TokenBudget,
        token_counter: TokenCounter = default_token_count,
    ) -> None:
        self.code_context = code_context
        self.doc_context = doc_context
        self.compressor = nl_compressor
        self.pruner = pruner
        self.budget = budget
        self.token_counter = token_counter
        self._hoisted_symbols: set[str] = set()  # SymbolRegistry — never hoist the same slice twice

    def _count(self, text: str) -> int:
        return self.token_counter(text)

    # --- budget (ADR-0022) -----------------------------------------------------------------------
    def estimate_lane_footprint(self, system: str, global_ast: str, diff: str) -> int:
        """The essential, un-prunable prefix must fit the hard limit, else decompose (ADR-0022)."""
        estimated = self._count(f"{system}\n{global_ast}\n{diff}")
        if estimated > self.budget.max_input:
            raise ContextBudgetExceededError(
                f"Lane essential footprint ({estimated} tokens) exceeds hard limit "
                f"({self.budget.max_input}). Planner must decompose."
            )
        return estimated

    # --- assembly (ADR-0004/0021) — the single path ----------------------------------------------
    def assemble(
        self, system: str, global_ast: str, diff: str, suffix: tuple[str, ...]
    ) -> AssembledPrompt:
        """Stable prefix + DCP-pruned suffix, budget-enforced. The one way a task packet is built."""
        prefix_tokens = self._count(system) + self._count(global_ast) + self._count(diff)
        total = prefix_tokens + sum(self._count(t) for t in suffix)
        pruned = self.pruner.prune_suffix(suffix, self.budget.max_input, total)
        new_total = prefix_tokens + sum(self._count(t) for t in pruned)
        if new_total > self.budget.max_input:
            raise ContextBudgetExceededError(
                f"Assembled payload ({new_total} tokens) exceeds budget "
                f"({self.budget.max_input}) even after pruning. Planner must decompose."
            )
        return AssembledPrompt(system=system, global_ast=global_ast, diff=diff, suffix=tuple(pruned))

    # --- firewall hoisting (ADR-0004) ------------------------------------------------------------
    def hoist_docs(self, library_names: list[str]) -> str:
        """Context7 docs, compressed via Headroom (NL channel — compressible)."""
        return "\n".join(
            self.compressor.compress(self.doc_context.library_docs(lib), self.budget).text
            for lib in library_names
        )

    def hoist_code(self, symbols: list[str]) -> str:
        """Exact AST slices via CodeContext (lossless), deduped across the payload."""
        slices: list[str] = []
        for sym in symbols:
            if sym not in self._hoisted_symbols:
                slices.append(self.code_context.symbol(sym).content)
                self._hoisted_symbols.add(sym)
        return "\n".join(slices)

    def pack_payload(
        self,
        ticket: str,
        dag_state: dict[str, Any],
        history: list[dict[str, str]],
        libs: list[str],
        symbols: list[str],
    ) -> AssembledPrompt:
        """Full firewall pass → a budget-safe, cache-stable AssembledPrompt."""
        system = f"BASE_PERSONA & SKILL_PERSONA_HERE\n\n{self.hoist_docs(libs)}"
        global_ast = self.hoist_code(symbols)
        diff = ""
        self.estimate_lane_footprint(system, global_ast, diff)  # essential must fit (ADR-0022)
        dag_state_str = json.dumps(dag_state, separators=(",", ":"))
        history_str = "\n".join(f"[{h['role'].upper()}]: {h['content']}" for h in history)
        suffix = (
            f"--- EXECUTION STATE ---\n{dag_state_str}\n\n"
            f"--- RECENT HISTORY ---\n{history_str}\n\n"
            f"--- CURRENT TICKET ---\n{ticket}"
        )
        return self.assemble(system, global_ast, diff, (suffix,))
