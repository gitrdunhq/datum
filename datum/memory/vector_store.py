"""Numpy-backed flat vector store — the ChromaDB replacement for v1 (<100k chunks).

Design rationale (from rag-corpus-context.md §1.2):
  - Brute-force cosine over 384-dim vectors is <5ms up to ~50k chunks.
  - No external dependencies beyond numpy (already present via [memory]).
  - Same upsert/query/delete/list_collections interface as the ChromaDB VectorStore
    so RAGEngine needs only a one-line swap.

Persistence layout per collection (inside store_dir/):
  <collection>.npz   — numpy archive: "ids", "vectors" (shape N×D)
  <collection>.meta.jsonl — one JSON object per row (same order as npz)

These files are written atomically (write-tmp → rename) so a crash mid-write
never leaves a corrupt index.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from datum.memory._strict import is_memory_strict
from datum.shared.logging import get_logger

logger = get_logger(__name__)


def _cosine_topk(
    matrix: np.ndarray,
    vec: np.ndarray,
    k: int,
) -> list[tuple[int, float]]:
    """Return top-k (index, cosine_similarity) pairs from matrix × vec.

    Pure numpy — no sklearn, no torch.  Safe against zero-norm rows and a
    zero-norm query.

    Args:
        matrix: Shape (N, D) float32/float64 array of stored vectors.
        vec:    Shape (D,) query vector.
        k:      Number of nearest neighbours to return.

    Returns:
        List of (row_index, cosine_similarity) sorted descending by similarity,
        length min(k, N).
    """
    if matrix.shape[0] == 0:
        return []

    # Compute norms; avoid division by zero with a small epsilon.
    row_norms = np.linalg.norm(matrix, axis=1)
    query_norm = float(np.linalg.norm(vec))

    if query_norm < 1e-10:
        # Zero query — every result is equally irrelevant; return zeros.
        return [(int(i), 0.0) for i in range(min(k, matrix.shape[0]))]

    # Dot product divided by norms.
    safe_row_norms = np.where(row_norms < 1e-10, 1.0, row_norms)
    sims: np.ndarray = matrix.dot(vec) / (safe_row_norms * query_norm)

    # Clamp to [-1, 1] to handle float rounding.
    sims = np.clip(sims, -1.0, 1.0)

    actual_k = min(k, matrix.shape[0])
    # argpartition is O(N) for the top-k selection; then sort the slice.
    if actual_k >= matrix.shape[0]:
        top_indices = np.argsort(-sims)
    else:
        # np.argpartition gives the k largest (unsorted), argsort the slice.
        part = np.argpartition(-sims, actual_k - 1)[:actual_k]
        top_indices = part[np.argsort(-sims[part])]

    return [(int(idx), float(sims[idx])) for idx in top_indices]


class NumpyVectorStore:
    """Numpy-backed flat vector store.

    Each collection lives in two files inside store_dir:
      <name>.npz           — "ids" (str array) + "vectors" (float32, N×D)
      <name>.meta.jsonl    — one JSON object per row (metadata dicts)

    The files are loaded on demand and cached in memory.  All writes are
    atomic (temp-file + replace).

    Public API mirrors the ChromaDB VectorStore so RAGEngine only needs a
    one-line change in _get_vector_store().
    """

    def __init__(self, store_dir: Path) -> None:
        self._dir = store_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        # In-memory cache: collection_name → (ids_list, vectors_array, meta_list)
        self._cache: dict[str, tuple[list[str], np.ndarray, list[dict]]] = {}

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    def _npz_path(self, collection: str) -> Path:
        return self._dir / f"{collection}.npz"

    def _meta_path(self, collection: str) -> Path:
        return self._dir / f"{collection}.meta.jsonl"

    def _load(self, collection: str) -> tuple[list[str], np.ndarray, list[dict]]:
        """Load collection from disk into the cache (or return empty state)."""
        if collection in self._cache:
            return self._cache[collection]

        npz_path = self._npz_path(collection)
        meta_path = self._meta_path(collection)

        if not npz_path.exists():
            # Empty collection — normalise to a zero-row sentinel.
            empty: tuple[list[str], np.ndarray, list[dict]] = (
                [],
                np.empty((0, 0), dtype=np.float32),
                [],
            )
            self._cache[collection] = empty
            return empty

        try:
            archive = np.load(str(npz_path), allow_pickle=False)
            ids: list[str] = archive["ids"].tolist()
            vectors: np.ndarray = archive["vectors"].astype(np.float32)
        except Exception as exc:
            if is_memory_strict():
                raise
            logger.warning(
                "NumpyVectorStore: corrupt npz for %r: %s — returning empty",
                collection,
                exc,
            )
            empty = ([], np.empty((0, 0), dtype=np.float32), [])
            self._cache[collection] = empty
            return empty

        meta: list[dict] = []
        if meta_path.exists():
            try:
                for line in meta_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line:
                        meta.append(json.loads(line))
            except Exception as exc:
                if is_memory_strict():
                    raise
                logger.warning(
                    "NumpyVectorStore: corrupt meta for %r: %s — using empty meta",
                    collection,
                    exc,
                )
                meta = [{} for _ in ids]

        # Pad or trim meta to match ids length.
        if len(meta) < len(ids):
            meta.extend([{}] * (len(ids) - len(meta)))
        elif len(meta) > len(ids):
            meta = meta[: len(ids)]

        result: tuple[list[str], np.ndarray, list[dict]] = (ids, vectors, meta)
        self._cache[collection] = result
        return result

    def _save(
        self, collection: str, ids: list[str], vectors: np.ndarray, meta: list[dict]
    ) -> None:
        """Persist collection to disk atomically and update cache."""
        npz_path = self._npz_path(collection)
        meta_path = self._meta_path(collection)

        # Write npz atomically.
        # np.savez auto-appends ".npz" to whatever string it receives, so we
        # pass a path string without ".npz" at the end.  The actual file numpy
        # creates is <tmp_stem_str>.npz; we rename that to npz_path.
        tmp_stem_str = str(npz_path.parent / (npz_path.stem + "._tmp_"))
        tmp_npz_actual = Path(tmp_stem_str + ".npz")
        # Store ids as unicode strings (dtype=str) so allow_pickle=False works on load.
        np.savez(
            tmp_stem_str,  # numpy writes to tmp_stem_str + ".npz"
            ids=np.array(ids, dtype=str),
            vectors=vectors.astype(np.float32),
        )
        tmp_npz_actual.replace(npz_path)

        # Write meta atomically.
        tmp_meta = meta_path.with_suffix(".meta.jsonl.tmp")
        lines = "\n".join(json.dumps(m) for m in meta)
        tmp_meta.write_text(lines + "\n" if lines else "", encoding="utf-8")
        tmp_meta.replace(meta_path)

        self._cache[collection] = (ids, vectors.astype(np.float32), meta)

    # ------------------------------------------------------------------ #
    # Public API (mirrors ChromaDB VectorStore)                           #
    # ------------------------------------------------------------------ #

    def add(
        self,
        collection: str,
        texts: list[str],
        embeddings: list[list[float]],
        metadata: list[dict],
    ) -> None:
        """Append new items to a collection (no dedup).

        Args:
            collection: Collection name.
            texts:      Plain text for each item (stored in metadata as "text").
            embeddings: One float list per item (must all be same length).
            metadata:   One dict per item; "text" key is added automatically.
        """
        if not texts:
            return
        existing_ids, existing_vecs, existing_meta = self._load(collection)

        new_ids = [_chunk_id_from_text(t) for t in texts]
        new_vecs = np.array(embeddings, dtype=np.float32)
        new_meta = [{**m, "text": t} for m, t in zip(metadata, texts, strict=True)]

        if existing_vecs.shape[0] == 0:
            merged_ids = new_ids
            merged_vecs = new_vecs
            merged_meta = new_meta
        else:
            merged_ids = existing_ids + new_ids
            merged_vecs = np.vstack([existing_vecs, new_vecs])
            merged_meta = existing_meta + new_meta

        self._save(collection, merged_ids, merged_vecs, merged_meta)

    def upsert(
        self,
        collection: str,
        ids: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
    ) -> None:
        """Insert or replace items by id.

        Args:
            collection: Collection name.
            ids:        Unique chunk ids.
            embeddings: One float list per item.
            metadatas:  One metadata dict per item.
        """
        if not ids:
            return
        existing_ids, existing_vecs, existing_meta = self._load(collection)

        # Build index of existing ids for O(1) lookup.
        id_to_pos: dict[str, int] = {cid: i for i, cid in enumerate(existing_ids)}

        merged_ids = list(existing_ids)
        # Use object array first so we can grow; convert to float32 at save time.
        merged_vecs_list: list[list[float]] = (
            existing_vecs.tolist() if existing_vecs.shape[0] > 0 else []
        )
        merged_meta = list(existing_meta)

        for cid, emb, meta in zip(ids, embeddings, metadatas, strict=True):
            if cid in id_to_pos:
                pos = id_to_pos[cid]
                merged_vecs_list[pos] = emb
                merged_meta[pos] = meta
            else:
                id_to_pos[cid] = len(merged_ids)
                merged_ids.append(cid)
                merged_vecs_list.append(emb)
                merged_meta.append(meta)

        merged_vecs = np.array(merged_vecs_list, dtype=np.float32)
        self._save(collection, merged_ids, merged_vecs, merged_meta)

    def query(
        self,
        collection: str,
        query_embedding: list[float],
        top_k: int = 5,
    ) -> list[tuple[str, dict, float]]:
        """Cosine-similarity top-k search.

        Args:
            collection:       Collection name.
            query_embedding:  Query vector (list of floats).
            top_k:            Number of results to return.

        Returns:
            List of (id, metadata_dict, cosine_similarity) sorted descending.
            Empty list if the collection does not exist.
        """
        ids, vectors, meta = self._load(collection)
        if not ids:
            return []

        q = np.array(query_embedding, dtype=np.float32)
        top = _cosine_topk(vectors, q, top_k)
        return [(ids[i], meta[i], score) for i, score in top]

    def list_collections(self) -> list[str]:
        """Return all collection names (based on .npz files on disk)."""
        return sorted(p.stem for p in self._dir.glob("*.npz"))

    def delete_collection(self, collection: str) -> None:
        """Remove a collection entirely from disk and cache."""
        self._cache.pop(collection, None)
        for path in (self._npz_path(collection), self._meta_path(collection)):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                if is_memory_strict():
                    raise
                logger.warning("NumpyVectorStore: failed to delete %s", path)

    def delete(self, collection: str, ids: list[str]) -> int:
        """Remove specific entries by id.  Returns count deleted."""
        if not ids:
            return 0
        existing_ids, existing_vecs, existing_meta = self._load(collection)
        if not existing_ids:
            return 0

        drop = set(ids)
        keep_mask = [cid not in drop for cid in existing_ids]
        kept_ids = [
            cid for cid, keep in zip(existing_ids, keep_mask, strict=True) if keep
        ]
        kept_meta = [
            m for m, keep in zip(existing_meta, keep_mask, strict=True) if keep
        ]

        if existing_vecs.shape[0] > 0:
            kept_vecs = existing_vecs[np.array(keep_mask)]
        else:
            kept_vecs = existing_vecs

        deleted = len(existing_ids) - len(kept_ids)
        self._save(collection, kept_ids, kept_vecs, kept_meta)
        return deleted

    def should_insert(
        self,
        collection_name: str,
        embedding: list[float],
        threshold: float = 0.95,
    ) -> bool:
        """Return True if no near-duplicate exists above threshold similarity."""
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
        for cid, emb, meta in zip(ids, embeddings, metadatas, strict=True):
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


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _chunk_id_from_text(text: str) -> str:
    """Deterministic 16-char id derived from SHA-256 of the text."""
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
