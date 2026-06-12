"""Tests for datum.memory.rag_engine wired to NumpyVectorStore.

All tests use FakeEmbeddings (deterministic, no model downloads) injected via
the embedding_provider constructor seam.  Real tmp_path sqlite/npz on disk.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import pytest

from datum.memory.embeddings import EmbeddingModelMismatchError, EmbeddingProvider
from datum.memory.rag_engine import RAGEngine, RetrievalResult
from datum.memory.vector_store import NumpyVectorStore

# ---------------------------------------------------------------------------
# FakeEmbeddings — same class as test_memory_embeddings but local for clarity
# ---------------------------------------------------------------------------


class FakeEmbeddings(EmbeddingProvider):
    """Deterministic 8-dim unit vectors, no deps, no I/O."""

    DIMENSION = 8

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, query: str) -> list[float]:
        return self._vector(query)

    @property
    def dimension(self) -> int:
        return self.DIMENSION

    @staticmethod
    def _vector(text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        raw = [b / 255.0 for b in digest[: FakeEmbeddings.DIMENSION]]
        norm = math.sqrt(sum(x * x for x in raw)) or 1.0
        return [x / norm for x in raw]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_knowledge_md(content: str, parent_dir: Path) -> Path:
    """Create parent_dir and write KNOWLEDGE.md there; return its path."""
    parent_dir.mkdir(parents=True, exist_ok=True)
    path = parent_dir / "KNOWLEDGE.md"
    path.write_text(content, encoding="utf-8")
    return path


_MINIMAL_KNOWLEDGE_MD = """\
## Patterns Found
- [2026-01-01] Always validate input before processing (Source: code-review)
- [2026-01-02] Use structured logging over print statements (Source: style-guide)

## False Positives to Avoid
- [2026-01-03] Do not flag intentional debug prints in test files (Source: testing)
"""


# ---------------------------------------------------------------------------
# RAGEngine construction
# ---------------------------------------------------------------------------


class TestRAGEngineInit:
    def test_requires_explicit_store_dir(self) -> None:
        with pytest.raises(ValueError, match="explicit store_dir"):
            RAGEngine(store_dir=None, embedding_provider=FakeEmbeddings())

    def test_creates_store_dir(self, tmp_path: Path) -> None:
        RAGEngine(store_dir=tmp_path / "store", embedding_provider=FakeEmbeddings())
        assert (tmp_path / "store").is_dir()

    def test_uses_numpy_vector_store(self, tmp_path: Path) -> None:
        engine = RAGEngine(store_dir=tmp_path, embedding_provider=FakeEmbeddings())
        assert isinstance(engine._store, NumpyVectorStore)


# ---------------------------------------------------------------------------
# RAGEngine.index + query — KNOWLEDGE.md reviewer flow
# ---------------------------------------------------------------------------


class TestRAGEngineIndexQuery:
    def test_index_returns_chunk_count(self, tmp_path: Path) -> None:
        engine = RAGEngine(store_dir=tmp_path, embedding_provider=FakeEmbeddings())
        path = _make_knowledge_md(_MINIMAL_KNOWLEDGE_MD, tmp_path / "reviewer")

        count = engine.index("security", path)

        assert count == 3  # three bullet entries in the test fixture

    def test_query_returns_retrieval_results(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        km_dir = tmp_path / "reviewer"
        km_dir.mkdir()
        km_path = km_dir / "KNOWLEDGE.md"
        km_path.write_text(_MINIMAL_KNOWLEDGE_MD, encoding="utf-8")
        engine.index("security", km_path)

        results = engine.query("security", "validate input", top_k=2)

        assert len(results) <= 2
        assert all(isinstance(r, RetrievalResult) for r in results)
        assert all(isinstance(r.score, float) for r in results)

    def test_query_scores_sorted_descending(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        km_dir = tmp_path / "reviewer"
        km_dir.mkdir()
        km_path = km_dir / "KNOWLEDGE.md"
        km_path.write_text(_MINIMAL_KNOWLEDGE_MD, encoding="utf-8")
        engine.index("security", km_path)

        results = engine.query("security", "logging structured", top_k=3)

        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_query_empty_collection_returns_empty(self, tmp_path: Path) -> None:
        engine = RAGEngine(store_dir=tmp_path, embedding_provider=FakeEmbeddings())
        results = engine.query("nonexistent", "anything", top_k=5)
        assert results == []


# ---------------------------------------------------------------------------
# RAGEngine.needs_reindex
# ---------------------------------------------------------------------------


class TestRAGEngineNeedsReindex:
    def test_unindexed_file_needs_reindex(self, tmp_path: Path) -> None:
        engine = RAGEngine(store_dir=tmp_path, embedding_provider=FakeEmbeddings())
        f = tmp_path / "KNOWLEDGE.md"
        f.write_text("## Patterns Found\n", encoding="utf-8")
        assert engine.needs_reindex("security", f) is True

    def test_indexed_unchanged_file_does_not_need_reindex(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        km_dir = tmp_path / "reviewer"
        km_dir.mkdir()
        km_path = km_dir / "KNOWLEDGE.md"
        km_path.write_text(_MINIMAL_KNOWLEDGE_MD, encoding="utf-8")
        engine.index("security", km_path)

        assert engine.needs_reindex("security", km_path) is False

    def test_modified_file_needs_reindex(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        km_dir = tmp_path / "reviewer"
        km_dir.mkdir()
        km_path = km_dir / "KNOWLEDGE.md"
        km_path.write_text(_MINIMAL_KNOWLEDGE_MD, encoding="utf-8")
        engine.index("security", km_path)
        km_path.write_text(
            _MINIMAL_KNOWLEDGE_MD + "\n- [2026-06-01] Extra entry (Source: new)\n",
            encoding="utf-8",
        )

        assert engine.needs_reindex("security", km_path) is True


# ---------------------------------------------------------------------------
# RAGEngine.search — general corpus search
# ---------------------------------------------------------------------------


class TestRAGEngineSearch:
    def _engine_with_docs(self, tmp_path: Path) -> RAGEngine:
        engine = RAGEngine(store_dir=tmp_path, embedding_provider=FakeEmbeddings())
        texts = [
            "numpy cosine similarity brute force",
            "sqlite ingestion ledger dedup",
            "generic chunker markdown toml",
        ]
        fake = FakeEmbeddings()
        embeddings = fake.embed(texts)
        metas = [
            {
                "text": t,
                "source": f"docs/doc{i}.md",
                "section": "body",
                "chunk_id": f"c{i}",
            }
            for i, t in enumerate(texts)
        ]
        ids = [f"c{i}" for i in range(len(texts))]
        engine._store.upsert("docs", ids, embeddings, metas)
        return engine

    def test_search_returns_results(self, tmp_path: Path) -> None:
        engine = self._engine_with_docs(tmp_path)
        results = engine.search("cosine similarity", collection="docs", top_k=3)
        assert len(results) >= 1
        assert all(isinstance(r, RetrievalResult) for r in results)

    def test_search_top_result_is_most_relevant(self, tmp_path: Path) -> None:
        engine = self._engine_with_docs(tmp_path)
        results = engine.search(
            "numpy cosine similarity brute force", collection="docs", top_k=3
        )
        assert results[0].chunk.source == "docs/doc0.md"

    def test_search_empty_collection_returns_empty(self, tmp_path: Path) -> None:
        engine = RAGEngine(store_dir=tmp_path, embedding_provider=FakeEmbeddings())
        results = engine.search("anything", collection="empty_col", top_k=5)
        assert results == []

    def test_search_scores_descending(self, tmp_path: Path) -> None:
        engine = self._engine_with_docs(tmp_path)
        results = engine.search("ledger sqlite", collection="docs", top_k=3)
        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)


# ---------------------------------------------------------------------------
# RAGEngine — provider mismatch detection
# ---------------------------------------------------------------------------


class TestRAGEngineProviderMismatch:
    def test_mismatch_raises_on_query(self, tmp_path: Path) -> None:
        """Index with FakeEmbeddings, then load with a different provider name."""
        store_dir = tmp_path / "store"
        engine_a = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        km_dir = tmp_path / "reviewer"
        km_dir.mkdir()
        km_path = km_dir / "KNOWLEDGE.md"
        km_path.write_text(_MINIMAL_KNOWLEDGE_MD, encoding="utf-8")
        engine_a.index("security", km_path)

        # Tamper with the provider metadata to simulate a mismatch.
        meta_file = store_dir / "_provider_metadata.json"
        meta_file.write_text(json.dumps({"provider": "OldProvider", "dimension": 8}))

        engine_b = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        with pytest.raises(EmbeddingModelMismatchError, match="mismatch"):
            engine_b.query("security", "test", top_k=1)

    def test_mismatch_raises_on_search(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        meta_file = store_dir / "_provider_metadata.json"
        store_dir.mkdir(parents=True, exist_ok=True)
        meta_file.write_text(json.dumps({"provider": "OldProvider", "dimension": 8}))

        with pytest.raises(EmbeddingModelMismatchError, match="mismatch"):
            engine.search("test", "docs", top_k=1)


# ---------------------------------------------------------------------------
# RAGEngine.reindex_all
# ---------------------------------------------------------------------------


class TestRAGEngineReindexAll:
    def test_reindex_drops_all_collections(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        fake = FakeEmbeddings()
        for col in ("col_a", "col_b"):
            engine._store.upsert(
                col, ["id1"], [fake.embed(["text"])[0]], [{"text": "text"}]
            )

        dropped = engine.reindex_all()

        assert dropped == 2
        assert engine._store.list_collections() == []

    def test_reindex_clears_hashes(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        km_dir = tmp_path / "reviewer"
        km_dir.mkdir()
        km_path = km_dir / "KNOWLEDGE.md"
        km_path.write_text(_MINIMAL_KNOWLEDGE_MD, encoding="utf-8")
        engine.index("security", km_path)
        assert engine._hashes  # has entries

        engine.reindex_all()

        assert engine._hashes == {}
        # After reindex, the file is considered unindexed again.
        assert engine.needs_reindex("security", km_path) is True


# ---------------------------------------------------------------------------
# RAGEngine — provider metadata persistence
# ---------------------------------------------------------------------------


class TestRAGEngineProviderMetadata:
    def test_provider_metadata_written_on_index(self, tmp_path: Path) -> None:
        store_dir = tmp_path / "store"
        engine = RAGEngine(store_dir=store_dir, embedding_provider=FakeEmbeddings())
        km_dir = tmp_path / "reviewer"
        km_dir.mkdir()
        km_path = km_dir / "KNOWLEDGE.md"
        km_path.write_text(_MINIMAL_KNOWLEDGE_MD, encoding="utf-8")
        engine.index("security", km_path)

        meta = json.loads((store_dir / "_provider_metadata.json").read_text())
        assert meta["provider"] == "FakeEmbeddings"

    def test_no_metadata_file_validates_ok(self, tmp_path: Path) -> None:
        """Missing metadata file → providers considered matching (graceful degradation)."""
        engine = RAGEngine(store_dir=tmp_path, embedding_provider=FakeEmbeddings())
        assert engine._validate_provider_match() is True
