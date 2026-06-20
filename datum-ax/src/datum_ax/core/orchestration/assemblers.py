"""Context-assembler plugin registry (ADR-0032/0030).

The `ContextAssembler` port can have many adapters; the `ContextCrane` is the default and is always
present (mandatory). Importing this module registers the crane, so the composition root can resolve
it by key — the same port+adapter+registry shape as `REVIEW_GATES` / `PERSONA_REGISTRIES`.
"""

from __future__ import annotations

from typing import Any

from datum_ax.contracts.context_assembler import ContextAssembler
from datum_ax.core.orchestration.crane import ContextCrane
from datum_ax.registry import Registry

CONTEXT_ASSEMBLERS: Registry[ContextAssembler] = Registry("context-assembler")


@CONTEXT_ASSEMBLERS.register("crane")
def _build_crane(**kwargs: Any) -> ContextCrane:
    return ContextCrane(**kwargs)


__all__ = ["CONTEXT_ASSEMBLERS"]
