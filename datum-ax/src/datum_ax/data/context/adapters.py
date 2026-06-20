from datum_ax.contracts.context import (
    AstMap,
    NlDoc,
    SymbolSlice,
)
from datum_ax.contracts.inference import TokenBudget


class SerenaTokenSaveContext:
    """Stub adapter for Serena and TokenSave (CodeContext). Lossless."""

    def global_map(self) -> AstMap:
        return AstMap(symbols=())

    def symbol(self, name: str) -> SymbolSlice:
        return SymbolSlice(name=name, path="stub.py", content=f"def {name}(): pass")

    def references(self, name: str) -> tuple[SymbolSlice, ...]:
        return ()


class Context7DocContext:
    """Stub adapter for Context7 (DocContext)."""

    def library_docs(self, library: str, version: str | None = None) -> NlDoc:
        text = f"Docs for {library} {version or 'latest'}"
        return NlDoc(source=library, text=text, token_estimate=len(text) // 4)


class HeadroomNlCompressor:
    """Stub adapter for Headroom.ai (NlCompressor). Compressible NL only."""

    def compress(self, doc: NlDoc, budget: TokenBudget) -> NlDoc:
        compressed_text = f"[COMPRESSED] {doc.text[:20]}..."
        return NlDoc(source=doc.source, text=compressed_text, token_estimate=len(compressed_text) // 4)
