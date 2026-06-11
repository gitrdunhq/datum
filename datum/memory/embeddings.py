# tested-by: tests/test_embeddings.py
"""Generate embeddings for knowledge chunks.

Provides a unified interface with two backends:
1. sentence-transformers (semantic embeddings, preferred)
2. scikit-learn TF-IDF (keyword-based fallback)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from datum.shared.logging import get_logger

logger = get_logger(__name__)


class EmbeddingModelMismatchError(RuntimeError):
    """Raised when the current embedding model differs from the stored index model.

    The existing ChromaDB vectors are incompatible with the new model.
    Run `wfc helpers rag-reindex` to rebuild all embeddings from scratch.
    """


class EmbeddingProvider(ABC):
    """Abstract embedding interface."""

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts into vectors."""
        ...

    @abstractmethod
    def embed_query(self, query: str) -> list[float]:
        """Embed a single query text into a vector."""
        ...

    @property
    @abstractmethod
    def dimension(self) -> int:
        """Return the dimensionality of the embedding vectors."""
        ...


class SentenceTransformerEmbeddings(EmbeddingProvider):
    """Uses sentence-transformers for semantic embeddings."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        self.model_name = model_name
        self._model = None
        self._dimension_val = None

    @property
    def model(self):
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError:
                raise ImportError(
                    "Missing memory dependencies. "
                    "Run: uv tool install .[memory] or pip install .[memory]"
                ) from None
            self._model = SentenceTransformer(self.model_name)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        embeddings = self.model.encode(texts, convert_to_numpy=True)
        return [vec.tolist() for vec in embeddings]

    def embed_query(self, query: str) -> list[float]:
        return self.embed([query])[0]

    @property
    def dimension(self) -> int:
        if self._dimension_val is None:
            self._dimension_val = self.model.get_sentence_embedding_dimension()
        return self._dimension_val


class TfidfEmbeddings(EmbeddingProvider):
    """TF-IDF fallback when sentence-transformers is unavailable."""

    def __init__(
        self, max_features: int = 384, persist_path: Path | None = None
    ) -> None:
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
        except ImportError:
            raise ImportError(
                "Missing memory dependencies. "
                "Run: uv tool install .[memory] or pip install .[memory]"
            ) from None

        self._max_features = max_features
        self.vectorizer = TfidfVectorizer(max_features=max_features)
        self._fitted = False
        self._corpus: list[str] = []
        self._persist_path = persist_path
        if persist_path and Path(persist_path).exists():
            self._load(persist_path)

    def save(self, path: Path) -> None:
        """Persist the fitted vectorizer to disk."""
        import pickle

        if not self._fitted:
            return
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(str(path) + ".tmp")
        with open(tmp, "wb") as f:
            pickle.dump(  # nosemgrep: avoid-pickle -- self-produced cache file, not external input
                self.vectorizer, f
            )
        tmp.replace(path)

    def _load(self, path: Path) -> None:
        """Restore a previously fitted vectorizer from disk."""
        import pickle

        try:
            with open(path, "rb") as f:
                self.vectorizer = pickle.load(  # noqa: S301  # nosemgrep: unsafe-deserialization, avoid-pickle -- self-produced cache file, not external input
                    f
                )
            self._fitted = True
        except (OSError, pickle.UnpicklingError) as exc:
            get_logger(__name__).warning(
                "TfidfEmbeddings: failed to load from %s: %s — starting fresh",
                path,
                exc,
            )

    def fit(self, texts: list[str]) -> None:
        """Fit the vectorizer on a corpus of texts."""
        if not texts:
            return
        self._corpus = list(texts)
        self.vectorizer.fit(self._corpus)
        self._fitted = True
        if self._persist_path:
            self.save(self._persist_path)

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        if not self._fitted:
            self.fit(texts)
        matrix = self.vectorizer.transform(texts)
        return [row.toarray().flatten().tolist() for row in matrix]

    def embed_query(self, query: str) -> list[float]:
        if not self._fitted:
            raise RuntimeError(
                "TF-IDF vectorizer not fitted. Call embed() or fit() first."
            )
        matrix = self.vectorizer.transform([query])
        return matrix.toarray().flatten().tolist()

    @property
    def dimension(self) -> int:
        if self._fitted:
            return len(self.vectorizer.get_feature_names_out())
        return self._max_features


def get_embedding_provider(persist_dir: Path | None = None) -> EmbeddingProvider:
    """Get the best available embedding provider.

    Tries sentence-transformers first, falls back to TF-IDF.

    Args:
        persist_dir: Optional directory for persisting TF-IDF vectorizer state.

    Returns:
        An EmbeddingProvider instance.

    Raises:
        RuntimeError: If no embedding backend is available.
    """
    try:
        provider = SentenceTransformerEmbeddings()
        logger.info("Embedding provider: SentenceTransformerEmbeddings (semantic)")
        return provider
    except ImportError:
        logger.debug("sentence-transformers not available, trying TF-IDF fallback")

    try:
        persist_path = (persist_dir / "tfidf_vectorizer.pkl") if persist_dir else None
        provider = TfidfEmbeddings(persist_path=persist_path)
        logger.warning(
            "Embedding provider: TfidfEmbeddings (keyword fallback — "
            "install sentence-transformers for semantic search)"
        )
        return provider
    except ImportError:
        logger.debug("scikit-learn not available, no embedding backend found")

    raise ImportError(
        "Missing memory dependencies. "
        "Run: uv tool install .[memory] or pip install .[memory]"
    )
