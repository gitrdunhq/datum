"""ContextAssembler port (ADR-0030/0032/0033) — the context firewall/assembler seam.

The crane is the default (and mandatory) adapter; `core` consumers depend on this Protocol, never the
concrete class, and the composition root resolves the assembler from the `CONTEXT_ASSEMBLERS` registry
by key. One assembly authority is always present — a run without a context assembler is not a run.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from datum_ax.contracts.inference import AssembledPrompt, TokenBudget


@runtime_checkable
class ContextAssembler(Protocol):
    """The single context-assembly authority: persona composition + firewall hoist + budgeted,
    DCP-pruned assembly (ADR-0030)."""

    def compose_system(
        self, role_id: str, scope_tags: tuple[str, ...] = ..., docs: str = ...
    ) -> str: ...

    def lift_skills(self, scope_tags: tuple[str, ...]) -> str: ...

    def assemble(
        self,
        system: str,
        global_ast: str,
        diff: str,
        suffix: tuple[str, ...],
        budget: TokenBudget | None = ...,
    ) -> AssembledPrompt: ...

    def estimate_lane_footprint(self, system: str, global_ast: str, diff: str) -> int: ...

    def hoist_docs(self, library_names: list[str]) -> str: ...

    def hoist_code(self, symbols: list[str]) -> str: ...
