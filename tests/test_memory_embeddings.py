"""Tests for datum.memory.embeddings — provider selection and fallback.

First tests for datum/memory (the module header previously claimed a test
file that did not exist). All tests run fully offline: backends are
simulated by blocking or faking modules in sys.modules — no network, no
model downloads, no hard dependency on sentence-transformers or sklearn.
"""

from __future__ import annotations

import hashlib
import sys
import types

import pytest

from datum.memory.embeddings import (
    EmbeddingProvider,
    SentenceTransformerEmbeddings,
    TfidfEmbeddings,
    get_embedding_provider,
)

# ---------------------------------------------------------------------------
# FakeEmbeddings — deterministic, dependency-free test provider
# ---------------------------------------------------------------------------


class FakeEmbeddings(EmbeddingProvider):
    """Deterministic hash-derived vectors for tests (no deps, no I/O).

    Same text always maps to the same vector; different texts map to
    different vectors. Inject via the `embedding_provider` ctor seams.
    """

    DIMENSION = 8

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    def embed_query(self, query: str) -> list[float]:
        return self._vector(query)

    @property
    def dimension(self) -> int:
        return self.DIMENSION

    @staticmethod
    def _vector(text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        return [byte / 255.0 for byte in digest[: FakeEmbeddings.DIMENSION]]


# ---------------------------------------------------------------------------
# Import-control helpers
# ---------------------------------------------------------------------------


def _block_module(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    """Force `import <name>` to raise ImportError even if it is installed."""
    monkeypatch.setitem(sys.modules, name, None)


def _install_fake_sentence_transformers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make `import sentence_transformers` succeed without the real package."""
    fake = types.ModuleType("sentence_transformers")
    fake.SentenceTransformer = object  # never constructed in these tests
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake)


def _install_fake_sklearn(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make `from sklearn.feature_extraction.text import TfidfVectorizer` work."""

    class _FakeVectorizer:
        def __init__(self, max_features: int = 384) -> None:
            self.max_features = max_features

    text_mod = types.ModuleType("sklearn.feature_extraction.text")
    text_mod.TfidfVectorizer = _FakeVectorizer
    fe_mod = types.ModuleType("sklearn.feature_extraction")
    fe_mod.text = text_mod
    sk_mod = types.ModuleType("sklearn")
    sk_mod.feature_extraction = fe_mod
    monkeypatch.setitem(sys.modules, "sklearn", sk_mod)
    monkeypatch.setitem(sys.modules, "sklearn.feature_extraction", fe_mod)
    monkeypatch.setitem(sys.modules, "sklearn.feature_extraction.text", text_mod)


# ---------------------------------------------------------------------------
# get_embedding_provider — selection and fallback (the R1 regression)
# ---------------------------------------------------------------------------


class TestProviderSelection:
    def test_fallback_reached_when_sentence_transformers_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Regression: ST missing + sklearn present must yield TfidfEmbeddings.

        The original bug: get_embedding_provider caught ImportError from
        SentenceTransformerEmbeddings(), but that constructor imports
        nothing (the import is lazy inside the .model property), so the
        TF-IDF fallback was unreachable and the returned provider exploded
        at first embed() instead.
        """
        _block_module(monkeypatch, "sentence_transformers")
        _install_fake_sklearn(monkeypatch)

        provider = get_embedding_provider()

        assert isinstance(provider, TfidfEmbeddings)
        assert not isinstance(provider, SentenceTransformerEmbeddings)

    def test_sentence_transformers_preferred_when_available(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_sentence_transformers(monkeypatch)

        provider = get_embedding_provider()

        assert isinstance(provider, SentenceTransformerEmbeddings)

    def test_raises_import_error_when_no_backend_available(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Negative path: neither backend installed → ImportError, not a time bomb."""
        _block_module(monkeypatch, "sentence_transformers")
        _block_module(monkeypatch, "sklearn")

        with pytest.raises(ImportError, match=r"datum\[rag\]"):
            get_embedding_provider()

    def test_persist_dir_is_threaded_into_tfidf_provider(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        _block_module(monkeypatch, "sentence_transformers")
        _install_fake_sklearn(monkeypatch)

        provider = get_embedding_provider(persist_dir=tmp_path)

        assert isinstance(provider, TfidfEmbeddings)
        assert provider._persist_path == tmp_path / "tfidf_vectorizer.pkl"


# ---------------------------------------------------------------------------
# Error messages must name installable remedies
# ---------------------------------------------------------------------------


class TestErrorMessages:
    def test_st_lazy_import_error_names_sentence_transformers(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """datum[memory] is mlx/outlines — the old message pointed there wrongly."""
        _block_module(monkeypatch, "sentence_transformers")

        provider = SentenceTransformerEmbeddings()
        with pytest.raises(ImportError, match="sentence-transformers") as excinfo:
            _ = provider.model
        assert "[memory]" not in str(excinfo.value)

    def test_tfidf_import_error_names_rag_extra(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _block_module(monkeypatch, "sklearn")

        with pytest.raises(ImportError, match=r"datum\[rag\]") as excinfo:
            TfidfEmbeddings()
        assert "[memory]" not in str(excinfo.value)


# ---------------------------------------------------------------------------
# TfidfEmbeddings behavior
# ---------------------------------------------------------------------------


class TestTfidfEmbeddings:
    def test_embed_query_before_fit_raises_runtime_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_sklearn(monkeypatch)
        provider = TfidfEmbeddings()

        with pytest.raises(RuntimeError, match="not fitted"):
            provider.embed_query("anything")

    def test_embed_empty_list_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_sklearn(monkeypatch)
        provider = TfidfEmbeddings()

        assert provider.embed([]) == []

    def test_dimension_defaults_to_max_features_before_fit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_fake_sklearn(monkeypatch)
        provider = TfidfEmbeddings(max_features=64)

        assert provider.dimension == 64

    def test_fit_embed_roundtrip_with_real_sklearn(self, tmp_path) -> None:
        pytest.importorskip("sklearn")
        persist_path = tmp_path / "tfidf_vectorizer.pkl"
        provider = TfidfEmbeddings(persist_path=persist_path)
        corpus = ["the cat sat on the mat", "dogs chase cats", "ducks swim in ponds"]

        vectors = provider.embed(corpus)

        assert len(vectors) == 3
        assert all(len(vec) == provider.dimension for vec in vectors)
        assert persist_path.exists()  # fit persisted the vectorizer
        # A reloaded provider must answer queries without refitting.
        reloaded = TfidfEmbeddings(persist_path=persist_path)
        query_vec = reloaded.embed_query("cat mat")
        assert len(query_vec) == reloaded.dimension
        assert any(value > 0 for value in query_vec)


# ---------------------------------------------------------------------------
# FakeEmbeddings — the fake itself must be trustworthy
# ---------------------------------------------------------------------------


class TestFakeEmbeddings:
    def test_satisfies_provider_abc(self) -> None:
        assert isinstance(FakeEmbeddings(), EmbeddingProvider)

    def test_deterministic_and_dimension_8(self) -> None:
        fake = FakeEmbeddings()

        first = fake.embed_query("hello world")
        second = fake.embed_query("hello world")

        assert first == second
        assert len(first) == 8
        assert fake.dimension == 8

    def test_distinct_texts_produce_distinct_vectors(self) -> None:
        fake = FakeEmbeddings()

        vectors = fake.embed(["alpha", "beta"])

        assert vectors[0] != vectors[1]
