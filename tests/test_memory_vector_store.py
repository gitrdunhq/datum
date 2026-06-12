"""Tests for datum.memory.vector_store — NumpyVectorStore and cosine helpers.

All tests run offline: FakeEmbeddings from test_memory_embeddings provides
deterministic 8-dim vectors with no sklearn/sentence-transformers dependency.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np
import pytest

from datum.memory.vector_store import NumpyVectorStore, _cosine_topk

# ---------------------------------------------------------------------------
# FakeEmbeddings helper (local copy — avoids cross-module import in tests)
# ---------------------------------------------------------------------------


def _fake_vector(text: str, dim: int = 8) -> list[float]:
    """Deterministic hash-derived unit vector for a given text."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    raw = [b / 255.0 for b in digest[:dim]]
    norm = math.sqrt(sum(x * x for x in raw)) or 1.0
    return [x / norm for x in raw]


def _fake_embed(texts: list[str], dim: int = 8) -> list[list[float]]:
    return [_fake_vector(t, dim) for t in texts]


# ---------------------------------------------------------------------------
# _cosine_topk — pure numpy function
# ---------------------------------------------------------------------------


class TestCosineTopk:
    def test_identical_query_returns_score_one(self) -> None:
        vec = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        matrix = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float32)
        results = _cosine_topk(matrix, vec, k=1)
        assert results[0] == (0, pytest.approx(1.0, abs=1e-6))

    def test_orthogonal_vectors_return_score_zero(self) -> None:
        vec = np.array([1.0, 0.0], dtype=np.float32)
        matrix = np.array([[0.0, 1.0]], dtype=np.float32)
        results = _cosine_topk(matrix, vec, k=1)
        assert results[0][1] == pytest.approx(0.0, abs=1e-6)

    def test_sorted_descending(self) -> None:
        vec = np.array([1.0, 0.0], dtype=np.float32)
        matrix = np.array(
            [[0.0, 1.0], [0.6, 0.8], [1.0, 0.0]],
            dtype=np.float32,
        )
        results = _cosine_topk(matrix, vec, k=3)
        scores = [s for _, s in results]
        assert scores == sorted(scores, reverse=True)

    def test_k_larger_than_rows_returns_all(self) -> None:
        matrix = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
        vec = np.array([1.0, 0.0], dtype=np.float32)
        results = _cosine_topk(matrix, vec, k=100)
        assert len(results) == 2

    def test_empty_matrix_returns_empty(self) -> None:
        matrix = np.empty((0, 4), dtype=np.float32)
        vec = np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)
        assert _cosine_topk(matrix, vec, k=5) == []

    def test_zero_query_returns_zeros(self) -> None:
        matrix = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
        vec = np.array([0.0, 0.0], dtype=np.float32)
        results = _cosine_topk(matrix, vec, k=2)
        assert len(results) == 2
        assert all(s == pytest.approx(0.0, abs=1e-6) for _, s in results)

    def test_negative_similarity_clamped_above_minus_one(self) -> None:
        vec = np.array([1.0, 0.0], dtype=np.float32)
        matrix = np.array([[-1.0, 0.0]], dtype=np.float32)
        results = _cosine_topk(matrix, vec, k=1)
        assert results[0][1] >= -1.0


# ---------------------------------------------------------------------------
# NumpyVectorStore — construction and empty state
# ---------------------------------------------------------------------------


class TestNumpyVectorStoreEmpty:
    def test_query_empty_collection_returns_empty(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        result = store.query("noexist", [0.1] * 8, top_k=5)
        assert result == []

    def test_list_collections_empty_dir(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        assert store.list_collections() == []

    def test_delete_nonexistent_collection_is_noop(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.delete_collection("ghost")  # must not raise

    def test_delete_ids_from_empty_returns_zero(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        assert store.delete("ghost", ["id1"]) == 0


# ---------------------------------------------------------------------------
# NumpyVectorStore — upsert and query
# ---------------------------------------------------------------------------


class TestNumpyVectorStoreUpsert:
    def test_upsert_and_query_returns_correct_top_match(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        texts = ["alpha", "beta", "gamma"]
        embeddings = _fake_embed(texts)
        ids = [f"id_{i}" for i in range(3)]
        metas = [{"text": t} for t in texts]

        store.upsert("col", ids, embeddings, metas)

        # Query with the exact embedding of "alpha" — should rank first.
        q = _fake_vector("alpha")
        results = store.query("col", q, top_k=3)

        assert len(results) == 3
        top_id, top_meta, top_score = results[0]
        assert top_id == "id_0"
        assert top_meta["text"] == "alpha"
        assert top_score == pytest.approx(1.0, abs=1e-5)

    def test_upsert_replaces_existing_id(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        original_emb = _fake_vector("original")
        updated_emb = _fake_vector("updated")

        store.upsert("col", ["id1"], [original_emb], [{"text": "original"}])
        store.upsert("col", ["id1"], [updated_emb], [{"text": "updated"}])

        results = store.query("col", updated_emb, top_k=1)
        assert results[0][1]["text"] == "updated"

    def test_upsert_multiple_batches_accumulate(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.upsert("col", ["a"], [_fake_vector("a")], [{"text": "a"}])
        store.upsert("col", ["b"], [_fake_vector("b")], [{"text": "b"}])
        store.upsert("col", ["c"], [_fake_vector("c")], [{"text": "c"}])

        results = store.query("col", _fake_vector("b"), top_k=3)
        assert len(results) == 3

    def test_list_collections_after_upsert(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.upsert("docs", ["d1"], [_fake_vector("x")], [{}])
        store.upsert("specs", ["s1"], [_fake_vector("y")], [{}])

        assert sorted(store.list_collections()) == ["docs", "specs"]


# ---------------------------------------------------------------------------
# NumpyVectorStore — save / load round-trip
# ---------------------------------------------------------------------------


class TestNumpyVectorStorePersistence:
    def test_save_load_roundtrip(self, tmp_path: Path) -> None:
        """Data written by one store instance survives a fresh instance."""
        texts = ["persist_me", "also_me"]
        embeddings = _fake_embed(texts)
        ids = ["p1", "p2"]
        metas = [{"text": t, "source": "test"} for t in texts]

        store_a = NumpyVectorStore(tmp_path)
        store_a.upsert("col", ids, embeddings, metas)

        store_b = NumpyVectorStore(tmp_path)
        results = store_b.query("col", _fake_vector("persist_me"), top_k=2)

        assert len(results) == 2
        ids_returned = {r[0] for r in results}
        assert "p1" in ids_returned

    def test_metadata_survives_roundtrip(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        meta = {
            "text": "hello",
            "source": "docs/guide.md",
            "section": "intro",
            "chunk_id": "abc123",
        }
        store.upsert("col", ["id1"], [_fake_vector("hello")], [meta])

        fresh = NumpyVectorStore(tmp_path)
        results = fresh.query("col", _fake_vector("hello"), top_k=1)
        returned_meta = results[0][1]
        assert returned_meta["source"] == "docs/guide.md"
        assert returned_meta["section"] == "intro"

    def test_npz_and_meta_files_created(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.upsert("myco", ["x1"], [_fake_vector("x")], [{"text": "x"}])

        assert (tmp_path / "myco.npz").exists()
        assert (tmp_path / "myco.meta.jsonl").exists()


# ---------------------------------------------------------------------------
# NumpyVectorStore — delete
# ---------------------------------------------------------------------------


class TestNumpyVectorStoreDelete:
    def test_delete_removes_entry(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.upsert(
            "col",
            ["a", "b", "c"],
            _fake_embed(["a", "b", "c"]),
            [{"text": t} for t in "abc"],
        )

        deleted = store.delete("col", ["b"])

        assert deleted == 1
        results = store.query("col", _fake_vector("b"), top_k=5)
        remaining_ids = {r[0] for r in results}
        assert "b" not in remaining_ids
        assert {"a", "c"} <= remaining_ids

    def test_delete_nonexistent_id_counts_zero(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.upsert("col", ["a"], [_fake_vector("a")], [{"text": "a"}])
        deleted = store.delete("col", ["ghost"])
        assert deleted == 0

    def test_delete_collection_removes_files(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.upsert("gone", ["x"], [_fake_vector("x")], [{"text": "x"}])
        store.delete_collection("gone")

        assert not (tmp_path / "gone.npz").exists()
        fresh = NumpyVectorStore(tmp_path)
        assert fresh.query("gone", _fake_vector("x"), top_k=1) == []


# ---------------------------------------------------------------------------
# NumpyVectorStore — add() convenience method
# ---------------------------------------------------------------------------


class TestNumpyVectorStoreAdd:
    def test_add_appends_items(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.add("col", ["hello", "world"], _fake_embed(["hello", "world"]), [{}, {}])

        results = store.query("col", _fake_vector("hello"), top_k=2)
        assert len(results) == 2

    def test_add_stores_text_in_metadata(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.add(
            "col", ["stored_text"], [_fake_vector("stored_text")], [{"extra": "val"}]
        )

        results = store.query("col", _fake_vector("stored_text"), top_k=1)
        assert results[0][1]["text"] == "stored_text"
        assert results[0][1]["extra"] == "val"


# ---------------------------------------------------------------------------
# NumpyVectorStore — dedup helpers
# ---------------------------------------------------------------------------


class TestNumpyVectorStoreDedup:
    def test_should_insert_empty_collection(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        assert store.should_insert("col", _fake_vector("x")) is True

    def test_should_insert_false_for_near_duplicate(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        vec = _fake_vector("identical")
        store.upsert("col", ["id1"], [vec], [{"text": "identical"}])
        # Same vector — similarity = 1.0, above threshold 0.95
        assert store.should_insert("col", vec, threshold=0.95) is False

    def test_upsert_with_dedup_skips_near_duplicate(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        vec = _fake_vector("dupe")
        store.upsert("col", ["id1"], [vec], [{"text": "dupe"}])

        inserted, deduped = store.upsert_with_dedup(
            "col", ["id2"], [vec], [{"text": "dupe_copy"}], threshold=0.95
        )
        assert inserted == 0
        assert deduped == 1

    def test_upsert_with_dedup_inserts_distinct_vector(self, tmp_path: Path) -> None:
        store = NumpyVectorStore(tmp_path)
        store.upsert("col", ["id1"], [_fake_vector("cat")], [{"text": "cat"}])

        inserted, deduped = store.upsert_with_dedup(
            "col",
            ["id2"],
            [_fake_vector("completely_different_text_xyz")],
            [{"text": "xyz"}],
        )
        assert inserted == 1
        assert deduped == 0
