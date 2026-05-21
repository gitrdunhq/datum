"""RAG engine for knowledge retrieval.

Uses ChromaDB as the persistent local vector store backend.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from datum.scripts.knowledge.chunker import KnowledgeChunk, KnowledgeChunker
from datum.scripts.knowledge.embeddings import (
    EmbeddingModelMismatchError,
    EmbeddingProvider,
    get_embedding_provider,
)
from datum.scripts.memory._strict import is_memory_strict
from datum.scripts.memory._trace import memory_traced
from datum.shared.logging import get_logger

logger = get_logger(__name__)


@dataclass
class RetrievalResult:
    """A query result with similarity score."""

    chunk: KnowledgeChunk
    score: float


class VectorStore:
    """ChromaDB-backed persistent vector store."""

    def __init__(self, store_dir: Path) -> None:
        import chromadb

        store_dir.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(path=str(store_dir))

    def upsert(
        self,
        collection: str,
        ids: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
    ) -> None:
        coll = self._client.get_or_create_collection(
            name=collection, metadata={"hnsw:space": "cosine"}
        )
        coll.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas)

    def query(
        self,
        collection: str,
        query_embedding: list[float],
        top_k: int = 5,
    ) -> list[tuple[str, dict, float]]:
        import chromadb.errors

        try:
            coll = self._client.get_collection(name=collection)
        except chromadb.errors.NotFoundError:
            # Collection has never been indexed — always a valid empty result,
            # not an infrastructure failure. Never re-raise in strict mode.
            return []
        except Exception:
            if is_memory_strict():
                raise
            logger.warning("Collection '%s' not found in ChromaDB", collection)
            return []
        results = coll.query(query_embeddings=[query_embedding], n_results=top_k)
        out: list[tuple[str, dict, float]] = []
        if results and results["ids"]:
            ids = results["ids"][0]
            metadatas = results["metadatas"][0] if results["metadatas"] else [{}] * len(ids)
            distances = results["distances"][0] if results["distances"] else [0.0] * len(ids)
            for i, cid in enumerate(ids):
                similarity = max(0.0, 1.0 - distances[i])
                out.append((cid, metadatas[i], similarity))
        return out

    def list_collections(self) -> list[str]:
        """Return all collection names in ChromaDB."""
        return [c.name for c in self._client.list_collections()]

    def delete_collection(self, collection: str) -> None:

        try:
            self._client.delete_collection(name=collection)
        except Exception:
            if is_memory_strict():
                raise
            logger.warning("Failed to delete collection '%s' from ChromaDB", collection)

    def delete(self, collection: str, ids: list[str]) -> int:
        """Remove entries by id. Returns count deleted."""
        try:
            coll = self._client.get_collection(name=collection)
            coll.delete(ids=ids)
            return len(ids)
        except Exception:
            if is_memory_strict():
                raise
            logger.warning(
                "Failed to delete %d chunks from collection '%s' in ChromaDB", len(ids), collection
            )
            return 0

    def should_insert(
        self,
        collection_name: str,
        embedding: list[float],
        threshold: float = 0.95,
    ) -> bool:
        """Return True if no near-duplicate exists above *threshold* similarity."""
        results = self.query(collection_name, embedding, top_k=1)
        if not results:
            return True
        _cid, _meta, similarity = results[0]
        return similarity < threshold

    def upsert_with_dedup(
        self,
        collection_name: str,
        ids: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
        threshold: float = 0.95,
    ) -> tuple[int, int]:
        """Upsert items, skipping near-duplicates. Returns (inserted, deduped)."""
        inserted = 0
        deduped = 0
        for cid, emb, meta in zip(ids, embeddings, metadatas):
            if self.should_insert(collection_name, emb, threshold):
                self.upsert(collection_name, [cid], [emb], [meta])
                inserted += 1
            else:
                logger.debug(
                    "Skipping near-duplicate chunk id=%s in collection=%s",
                    cid,
                    collection_name,
                )
                deduped += 1
        return inserted, deduped


def _get_vector_store(store_dir: Path) -> VectorStore:
    """Return the ChromaDB-backed vector store."""
    return VectorStore(store_dir / "chroma")


class RAGEngine:
    """RAG engine for indexing and querying reviewer knowledge."""

    def __init__(
        self,
        store_dir: Path | None = None,
        embedding_provider: EmbeddingProvider | None = None,
    ) -> None:
        if store_dir is None:
            raise ValueError(
                "RAGEngine requires an explicit store_dir. "
                "Use Path.home() / '.datum' / 'projects' / repo_name / 'knowledge'."
            )
        self.store_dir = store_dir
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.provider = embedding_provider or get_embedding_provider(persist_dir=self.store_dir)
        self._chunker = KnowledgeChunker()
        self._hashes: dict[str, str] = {}
        self._hash_file = self.store_dir / "file_hashes.json"
        self._provider_meta_file = self.store_dir / "_provider_metadata.json"
        self._load_hashes()
        self._store = _get_vector_store(self.store_dir)

    @memory_traced("rag")
    def index(self, reviewer_id: str, knowledge_path: Path) -> int:
        """Index a single reviewer's KNOWLEDGE.md.

        Args:
            reviewer_id: The reviewer identifier (e.g. 'security').
            knowledge_path: Path to the KNOWLEDGE.md file.

        Returns:
            Number of chunks indexed.
        """
        chunks = self._chunker.parse_file(knowledge_path, reviewer_id)
        if not chunks:
            return 0

        texts = [c.text for c in chunks]
        ids = [c.chunk_id for c in chunks]
        metadatas = [asdict(c) for c in chunks]

        embeddings = self.provider.embed(texts)
        collection_name = f"reviewer_{reviewer_id}"
        self._store.upsert(
            collection=collection_name,
            ids=ids,
            embeddings=embeddings,
            metadatas=metadatas,
        )

        file_hash = self._compute_file_hash(knowledge_path)
        self._hashes[reviewer_id] = file_hash
        try:
            self._save_hashes()
            self._save_provider_metadata()
        except OSError:
            logger.warning("Failed to persist file hash for reviewer %s", reviewer_id)

        return len(chunks)

    @memory_traced("rag")
    def index_all(self, reviewers_dir: Path | None = None) -> dict[str, int]:
        """Index all reviewers' KNOWLEDGE.md files.

        Args:
            reviewers_dir: Path to the reviewers directory.
                Defaults to datum/reviewers/ relative to the project root.

        Returns:
            Dict mapping reviewer_id to number of chunks indexed.
        """
        if reviewers_dir is None:
            reviewers_dir = Path(__file__).resolve().parents[2] / "reviewers"

        results: dict[str, int] = {}
        if not reviewers_dir.is_dir():
            return results

        for reviewer_dir in sorted(reviewers_dir.iterdir()):
            knowledge_path = reviewer_dir / "KNOWLEDGE.md"
            if knowledge_path.is_file():
                reviewer_id = reviewer_dir.name
                count = self.index(reviewer_id, knowledge_path)
                results[reviewer_id] = count

        return results

    def needs_reindex(self, reviewer_id: str, knowledge_path: Path) -> bool:
        """Check if a KNOWLEDGE.md has changed since last indexing.

        Args:
            reviewer_id: The reviewer identifier.
            knowledge_path: Path to the KNOWLEDGE.md file.

        Returns:
            True if the file has changed or was never indexed.
        """
        current_hash = self._compute_file_hash(knowledge_path)
        stored_hash = self._hashes.get(reviewer_id)
        return stored_hash != current_hash

    @memory_traced("rag")
    def query(
        self,
        reviewer_id: str,
        query_text: str,
        top_k: int = 5,
    ) -> list[RetrievalResult]:
        """Query a reviewer's knowledge for relevant entries.

        Args:
            reviewer_id: The reviewer to query.
            query_text: The search query.
            top_k: Maximum number of results to return.

        Returns:
            List of RetrievalResult sorted by relevance (descending).
        """
        if not self._validate_provider_match():
            stored = json.loads(self._provider_meta_file.read_text(encoding="utf-8"))
            old_provider = stored.get("provider", "unknown")
            raise EmbeddingModelMismatchError(
                f"embedding provider mismatch: index built with {old_provider!r}, "
                f"current provider is {type(self.provider).__name__!r}. "
                "Run `datum rag-reindex` to rebuild all embeddings."
            )
        query_embedding = self.provider.embed_query(query_text)
        collection_name = f"reviewer_{reviewer_id}"
        raw_results = self._store.query(
            collection=collection_name,
            query_embedding=query_embedding,
            top_k=top_k,
        )

        results: list[RetrievalResult] = []
        for _cid, metadata, score in raw_results:
            chunk = KnowledgeChunk(
                text=metadata.get("text", query_text),
                reviewer_id=metadata.get("reviewer_id", reviewer_id),
                section=metadata.get("section", "unknown"),
                date=metadata.get("date", "unknown"),
                source=metadata.get("source", "unknown"),
                chunk_id=metadata.get("chunk_id", _cid),
            )
            results.append(RetrievalResult(chunk=chunk, score=score))

        return results

    @staticmethod
    def _compute_file_hash(path: Path) -> str:
        """SHA-256 hash of file contents."""
        content = path.read_bytes()
        return hashlib.sha256(content).hexdigest()

    def _load_hashes(self) -> None:
        if self._hash_file.exists():
            try:
                self._hashes = json.loads(self._hash_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Corrupt hash file at %s, starting fresh: %s", self._hash_file, exc)
                self._hashes = {}

    def _save_hashes(self) -> None:
        tmp = self._hash_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._hashes, indent=2), encoding="utf-8")
        tmp.replace(self._hash_file)

    def _save_provider_metadata(self) -> None:
        """Persist the current embedding provider name so mismatches can be detected."""
        meta = {
            "provider": type(self.provider).__name__,
            "dimension": getattr(self.provider, "dimension", None),
        }
        tmp = self._provider_meta_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta), encoding="utf-8")
        tmp.replace(self._provider_meta_file)

    def _validate_provider_match(self) -> bool:
        """Check if the stored provider matches the current one.

        Returns True if providers match (or no metadata exists).
        Returns False and logs a warning if providers differ.
        """
        if not self._provider_meta_file.exists():
            return True
        try:
            stored = json.loads(self._provider_meta_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return True
        current = type(self.provider).__name__
        stored_provider = stored.get("provider")
        if stored_provider != current:
            logger.warning(
                "embedding provider mismatch: index built with %r, current provider is %r. "
                "Run `datum rag-reindex` to rebuild all embeddings.",
                stored_provider,
                current,
            )
            return False
        return True

    def reindex_all(self) -> int:
        """Drop all ChromaDB collections. Returns count of collections dropped."""
        collections = self._store.list_collections()
        for name in collections:
            self._store.delete_collection(name)
        self._hashes.clear()
        return len(collections)

    def delete_chunks(self, chunk_ids: list[str], reviewer_id: str = "") -> int:
        """Delete vectors by chunk_id. Returns count of deleted entries."""
        if not chunk_ids:
            return 0
        collection_name = f"reviewer_{reviewer_id}" if reviewer_id else ""
        if collection_name:
            return self._store.delete(collection_name, chunk_ids)
        return 0
