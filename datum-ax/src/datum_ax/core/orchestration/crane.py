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
from datum_ax.contracts.persona import PersonaNotFoundError, PersonaRegistry
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
        persona: PersonaRegistry | None = None,
    ) -> None:
        self.code_context = code_context
        self.doc_context = doc_context
        self.compressor = nl_compressor
        self.pruner = pruner
        self.budget = budget
        self.token_counter = token_counter
        self.persona = persona
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
        self,
        system: str,
        global_ast: str,
        diff: str,
        suffix: tuple[str, ...],
        budget: TokenBudget | None = None,
    ) -> AssembledPrompt:
        """Stable prefix + DCP-pruned suffix, budget-enforced. The one way a task packet is built.

        Pass a per-call ``budget`` (e.g. a phase's own limit); defaults to the crane's budget.
        """
        b = budget or self.budget
        prefix_tokens = self._count(system) + self._count(global_ast) + self._count(diff)
        total = prefix_tokens + sum(self._count(t) for t in suffix)
        pruned = self.pruner.prune_suffix(suffix, b.max_input, total)
        new_total = prefix_tokens + sum(self._count(t) for t in pruned)
        if new_total > b.max_input:
            raise ContextBudgetExceededError(
                f"Assembled payload ({new_total} tokens) exceeds budget "
                f"({b.max_input}) even after pruning. Planner must decompose."
            )
        return AssembledPrompt(
            system=system, global_ast=global_ast, diff=diff, suffix=tuple(pruned)
        )

    # --- persona composition (ADR-0033) ----------------------------------------------------------
    def compose_system(
        self,
        role_id: str,
        scope_tags: tuple[str, ...] = (),
        docs: str = "",
        query: str | None = None,
    ) -> str:
        """Compose a lane's ``[System]`` text: BASE_PERSONA + Role + selected Skills (+docs).

        Skills come from two tiers (ADR-0034): structural ``scope_tags`` (purpose: planning /
        troubleshooting) and, when ``query`` is given, RAG domain-fit via ``persona.match_skills``
        (deterministic tags + reasoning-grade embeddings behind one port). Stable ordering for
        prompt-cache reuse: base → role → skills → docs. Requires an injected ``PersonaRegistry``.
        """
        if self.persona is None:
            raise PersonaNotFoundError(
                "no PersonaRegistry injected into the crane (ADR-0033); cannot compose system prompt"
            )
        role = self.persona.get_role(role_id)
        skills = list(self.persona.select_skills(tuple(scope_tags)))
        if query:
            seen = {s.id for s in skills}
            skills += [s for s in self.persona.match_skills(query) if s.id not in seen]
        parts = [p for p in (self.persona.base_persona(), role.body) if p]
        parts += self._render_skills(skills)
        if docs:
            parts.append(docs)
        return "\n\n".join(parts)

    @staticmethod
    def _render_skills(skills: list) -> list[str]:
        return [f"## Skill: {s.name}\n{s.instructions}" for s in skills]

    def _format_skills(self, scope_tags: tuple[str, ...]) -> list[str]:
        if self.persona is None:
            return []
        return self._render_skills(list(self.persona.select_skills(tuple(scope_tags))))

    def lift_skills(self, scope_tags: tuple[str, ...]) -> str:
        """Skills text for the VARIABLE slot — e.g. troubleshooting skills lifted into a retry suffix
        on failure, keeping the ``[System]`` prefix cache-stable (ADR-0033/0020). Empty when nothing
        matches or no registry is wired."""
        return "\n\n".join(self._format_skills(scope_tags))

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
        role_id: str = "executor",
        scope_tags: tuple[str, ...] = (),
    ) -> AssembledPrompt:
        """Full firewall pass → a budget-safe, cache-stable AssembledPrompt. The ``[System]`` prefix
        is the registry-resolved persona (Role + Skills) plus hoisted, compressed docs (ADR-0033)."""
        system = self.compose_system(role_id, scope_tags, docs=self.hoist_docs(libs))
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
