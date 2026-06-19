"""Context-firewall contracts (ADR-0004). Code channel is lossless (CodeContext: Serena +
TokenSave); NL channel is compressible (DocContext: Context7, then NlCompressor: Headroom.ai).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import Field

from datum_ax._base import Contract
from datum_ax.contracts.inference import TokenBudget


class SymbolSlice(Contract):
    """An exact, lossless slice of code — never compressed."""

    name: str = Field(min_length=1)
    path: str = Field(min_length=1)
    content: str
    language: str | None = None


class AstMap(Contract):
    symbols: tuple[SymbolSlice, ...] = ()


class NlDoc(Contract):
    """Natural-language documentation — the only compressible channel."""

    source: str = Field(min_length=1)
    text: str
    token_estimate: int = Field(ge=0)


@runtime_checkable
class CodeContext(Protocol):
    """Lossless code retrieval (Serena + TokenSave, data tier)."""

    def global_map(self) -> AstMap: ...

    def symbol(self, name: str) -> SymbolSlice: ...

    def references(self, name: str) -> tuple[SymbolSlice, ...]: ...


@runtime_checkable
class DocContext(Protocol):
    """Version-specific external docs (Context7, data tier)."""

    def library_docs(self, library: str, version: str | None = None) -> NlDoc: ...


@runtime_checkable
class NlCompressor(Protocol):
    """The single sanctioned compression point — NL only (Headroom.ai, data tier)."""

    def compress(self, doc: NlDoc, budget: TokenBudget) -> NlDoc: ...
