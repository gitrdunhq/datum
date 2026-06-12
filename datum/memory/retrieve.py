# tested-by: tests/test_memory_retrieve.py
"""Retrieval function for the datum RAG corpus.

Provides ``retrieve_context(query, ...)`` — a pure retrieval function that
searches corpus collections (failures, transcripts, specs) using TF-IDF
cosine similarity and returns sanitized context blocks for use in prompts.

Design notes:
- TF-IDF v1: fits on the collection corpus at query time (no pre-built index
  required). The v2 upgrade path is a swap behind the EmbeddingProvider ABC.
- Collections: "failures" (.datum/failures/*.json + .datum/tdd-failure.json),
  "transcripts" (.datum/transcripts/*.jsonl), "specs" (specs/*.toml),
  "all" (union of the above).
- Output is sanitized through datum.prompt_sanitizer (strip_special_tokens +
  strip_invisible_unicode + strip_secrets) because the corpus contains prior
  model output (transcripts) — a prompt-injection vector if replayed raw.
- 50-doc cap per collection, 3800-char total output cap.
- RLIMIT_AS=512MB enforcement in the lane-tool sandbox means no torch/
  sentence-transformers here; TF-IDF (sklearn) fits comfortably.
"""

from __future__ import annotations

import json
import resource
from pathlib import Path
from typing import Any

from datum.shared.logging import get_logger

logger = get_logger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

MAX_DOCS_PER_COLLECTION = 50
MAX_OUTPUT_CHARS = 3800
_RLIMIT_AS_BYTES = 512 * 1024 * 1024  # 512 MB


# ── Memory limit enforcement ───────────────────────────────────────────────────


def _enforce_memory_limit() -> None:
    """Apply RLIMIT_AS = 512 MB in the current process (idempotent, best-effort).

    Called once at the start of retrieve_context so the TF-IDF path never
    balloons past the lane-tool sandbox limit.  Silently skips on platforms
    or environments where the rlimit cannot be set.
    """
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        # Only lower the limit, never raise it.
        cap = _RLIMIT_AS_BYTES
        new_soft = min(soft, cap) if soft != resource.RLIM_INFINITY else cap
        new_hard = min(hard, cap) if hard != resource.RLIM_INFINITY else cap
        resource.setrlimit(resource.RLIMIT_AS, (new_soft, new_hard))
    except (OSError, ValueError, AttributeError):
        pass  # Non-Linux platforms, containers, or permission errors


# ── Document loaders ───────────────────────────────────────────────────────────


def _load_failures(repo_root: Path) -> list[tuple[str, str]]:
    """Load failure records as (source_path, text) pairs.

    Reads:
    - .datum/failures/*.json
    - .datum/tdd-failure.json (single root failure record)
    - .datum/runs/*/tdd-failure.json (historical run archives)
    """
    docs: list[tuple[str, str]] = []

    datum_dir = repo_root / ".datum"
    if not datum_dir.is_dir():
        return docs

    # Root failure record
    root_failure = datum_dir / "tdd-failure.json"
    if root_failure.is_file():
        try:
            obj = json.loads(root_failure.read_text(encoding="utf-8"))
            text = _flatten_json(obj)
            docs.append((str(root_failure.relative_to(repo_root)), text))
        except (json.JSONDecodeError, OSError) as exc:
            logger.debug("retrieve: skipping %s: %s", root_failure, exc)

    # .datum/failures/*.json directory (v2 layout, may not exist yet)
    failures_dir = datum_dir / "failures"
    if failures_dir.is_dir():
        for path in sorted(failures_dir.glob("*.json"))[:MAX_DOCS_PER_COLLECTION]:
            try:
                obj = json.loads(path.read_text(encoding="utf-8"))
                text = _flatten_json(obj)
                docs.append((str(path.relative_to(repo_root)), text))
            except (json.JSONDecodeError, OSError) as exc:
                logger.debug("retrieve: skipping %s: %s", path, exc)

    # Historical run archives
    runs_dir = datum_dir / "runs"
    if runs_dir.is_dir():
        for run_dir in sorted(runs_dir.iterdir()):
            if not run_dir.is_dir():
                continue
            run_failure = run_dir / "tdd-failure.json"
            if run_failure.is_file():
                try:
                    obj = json.loads(run_failure.read_text(encoding="utf-8"))
                    text = _flatten_json(obj)
                    docs.append((str(run_failure.relative_to(repo_root)), text))
                except (json.JSONDecodeError, OSError) as exc:
                    logger.debug("retrieve: skipping %s: %s", run_failure, exc)
            if len(docs) >= MAX_DOCS_PER_COLLECTION:
                break

    return docs[:MAX_DOCS_PER_COLLECTION]


def _load_transcripts(repo_root: Path) -> list[tuple[str, str]]:
    """Load transcript JSONL records as (source_path, text) pairs.

    Each JSONL line is one ReAct step.  We extract think_raw + observation
    (the semantically rich fields) and skip purely structural fields.
    """
    docs: list[tuple[str, str]] = []

    transcripts_dir = repo_root / ".datum" / "transcripts"
    if not transcripts_dir.is_dir():
        return docs

    for path in sorted(transcripts_dir.glob("*.jsonl"))[:MAX_DOCS_PER_COLLECTION]:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
            step_texts: list[str] = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    parts: list[str] = []
                    if think := obj.get("think_raw", ""):
                        parts.append(f"think: {think[:1500]}")
                    if obs := obj.get("observation", ""):
                        parts.append(f"observation: {obs[:500]}")
                    if parts:
                        step_texts.append(" | ".join(parts))
                except json.JSONDecodeError:
                    continue
            if step_texts:
                text = "\n".join(step_texts)
                docs.append((str(path.relative_to(repo_root)), text))
        except OSError as exc:
            logger.debug("retrieve: skipping %s: %s", path, exc)

    return docs[:MAX_DOCS_PER_COLLECTION]


def _load_specs(repo_root: Path) -> list[tuple[str, str]]:
    """Load spec TOML files as (source_path, text) pairs.

    Reads specs/*.toml from the repo root.  Each spec is loaded as raw text
    (TOML is readable prose; full parsing is unnecessary for TF-IDF).
    """
    docs: list[tuple[str, str]] = []

    specs_dir = repo_root / "specs"
    if not specs_dir.is_dir():
        return docs

    for path in sorted(specs_dir.glob("*.toml"))[:MAX_DOCS_PER_COLLECTION]:
        try:
            text = path.read_text(encoding="utf-8")
            if text.strip():
                docs.append((str(path.relative_to(repo_root)), text))
        except OSError as exc:
            logger.debug("retrieve: skipping %s: %s", path, exc)

    return docs[:MAX_DOCS_PER_COLLECTION]


# ── TF-IDF retrieval core ──────────────────────────────────────────────────────


def _cosine_topk(
    matrix: Any,
    query_vec: Any,
    k: int,
) -> list[tuple[int, float]]:
    """Brute-force cosine top-k over a sparse TF-IDF matrix.

    Args:
        matrix: scipy sparse matrix (n_docs × n_features) from vectorizer.transform.
        query_vec: sparse matrix (1 × n_features) from vectorizer.transform([query]).
        k: number of top results to return.

    Returns:
        List of (doc_index, cosine_similarity) sorted descending, length ≤ k.
    """
    import numpy as np  # guarded behind the [rag] extra
    from scipy.sparse import issparse  # guarded behind the [rag] extra

    # Convert to dense for cosine computation
    if issparse(matrix):
        doc_matrix = matrix.toarray()
    else:
        doc_matrix = np.asarray(matrix)

    if issparse(query_vec):
        qvec = query_vec.toarray().flatten()
    else:
        qvec = np.asarray(query_vec).flatten()

    # Cosine similarity: dot(A, q) / (||A|| * ||q||)
    norms_docs = np.linalg.norm(doc_matrix, axis=1)
    norm_q = np.linalg.norm(qvec)

    if norm_q == 0:
        return []

    # Avoid division by zero for zero-norm docs
    safe_norms = np.where(norms_docs == 0, 1.0, norms_docs)
    scores = doc_matrix.dot(qvec) / (safe_norms * norm_q)

    # Get top-k indices
    n = min(k, len(scores))
    if n == 0:
        return []

    top_indices = np.argpartition(scores, -n)[-n:]
    top_sorted = sorted(top_indices, key=lambda i: scores[i], reverse=True)
    return [(int(i), float(scores[i])) for i in top_sorted if scores[i] > 0]


def _tfidf_retrieve(
    docs: list[tuple[str, str]],
    query: str,
    top_k: int,
) -> list[tuple[str, str, float]]:
    """TF-IDF retrieval over a list of (source, text) documents.

    Returns list of (source, text, score) sorted by score descending.
    Returns [] if sklearn is unavailable or the corpus is empty.
    """
    if not docs:
        return []

    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
    except ImportError:
        logger.warning("retrieve: scikit-learn not available — install datum[rag]")
        return []

    texts = [text for _src, text in docs]

    vectorizer = TfidfVectorizer(max_features=384)
    try:
        matrix = vectorizer.fit_transform(texts)
        query_vec = vectorizer.transform([query])
    except ValueError as exc:
        # Empty vocabulary (e.g. all-stop-word corpus)
        logger.debug("retrieve: TF-IDF fit failed: %s", exc)
        return []

    ranked = _cosine_topk(matrix, query_vec, top_k)
    return [(docs[i][0], docs[i][1], score) for i, score in ranked]


# ── Sanitization ───────────────────────────────────────────────────────────────


def _sanitize(text: str) -> str:
    """Run the full sanitization chain: special tokens → invisible unicode → secrets."""
    from datum.prompt_sanitizer import (
        strip_invisible_unicode,
        strip_secrets,
        strip_special_tokens,
    )

    return strip_secrets(strip_invisible_unicode(strip_special_tokens(text)))


# ── Output rendering ───────────────────────────────────────────────────────────


def _render_results(
    results: list[tuple[str, str, float]],
    query: str,
    total_found: int,
    top_k: int,
    max_chars: int,
) -> str:
    """Render retrieval results as structured context blocks.

    Format:
        [RETRIEVED CONTEXT — query: "<query>" — top N of M]
        --- source/path (score: 0.82) ---
        <sanitized content>
        --- source/path (score: 0.71) ---
        <sanitized content>
    """
    if not results:
        return f'[RETRIEVED CONTEXT — query: "{query}" — 0 results]'

    header = (
        f'[RETRIEVED CONTEXT — query: "{query}" — top {len(results)} of {total_found}]'
    )
    # Reserve chars for header + newline
    remaining = max_chars - len(header) - 1
    if remaining <= 0:
        return header

    blocks: list[str] = []
    for source, text, score in results:
        block_header = f"--- {source} (score: {score:.2f}) ---"
        content = _sanitize(text)

        # Budget content within remaining chars
        separator = "\n"
        overhead = len(block_header) + len(separator) * 2
        content_budget = remaining - overhead
        if content_budget <= 0:
            break
        if len(content) > content_budget:
            content = content[:content_budget]

        block = f"{block_header}\n{content}"
        remaining -= len(block) + len(separator)
        blocks.append(block)

        if remaining <= 0:
            break

    return header + "\n" + "\n".join(blocks)


# ── JSON flattener ─────────────────────────────────────────────────────────────


def _flatten_json(obj: Any, max_depth: int = 3, _depth: int = 0) -> str:
    """Convert a JSON object to a flat text representation for TF-IDF indexing."""
    if _depth > max_depth:
        return str(obj)[:200]
    if isinstance(obj, str):
        return obj
    if isinstance(obj, (int, float, bool)) or obj is None:
        return str(obj)
    if isinstance(obj, list):
        return " ".join(_flatten_json(item, max_depth, _depth + 1) for item in obj[:20])
    if isinstance(obj, dict):
        parts = []
        for k, v in obj.items():
            flat_v = _flatten_json(v, max_depth, _depth + 1)
            parts.append(f"{k}: {flat_v}")
        return " | ".join(parts)
    return str(obj)


# ── Public API ─────────────────────────────────────────────────────────────────

_VALID_COLLECTIONS = frozenset({"failures", "transcripts", "specs", "all"})


def retrieve_context(
    query: str,
    *,
    collection: str | None = None,
    top_k: int = 5,
    max_chars: int = MAX_OUTPUT_CHARS,
    repo_root: Path | None = None,
) -> str:
    """Retrieve relevant context from the datum corpus using TF-IDF.

    Args:
        query: The search query string.
        collection: Which corpus collection to search. One of:
            "failures"    — .datum/failures/*.json + tdd-failure.json
            "transcripts" — .datum/transcripts/*.jsonl
            "specs"       — specs/*.toml
            "all"         — union of the above (default)
            None is treated as "all".
        top_k: Maximum number of documents to return (default 5, capped at 50).
        max_chars: Maximum total output characters (default 3800).
        repo_root: Root of the target repository. Defaults to Path.cwd().

    Returns:
        A formatted context block string, sanitized through prompt_sanitizer.
        If no relevant documents are found, returns a single-line header
        indicating 0 results.
        If the corpus is empty (no files exist), returns a human-readable
        message with guidance.

    Notes:
        - Output is sanitized: special tokens, invisible unicode, and credential
          patterns are stripped/redacted (corpus contains prior model output).
        - RLIMIT_AS is enforced at 512 MB (best-effort) to stay within the
          lane-tool sandbox budget.
        - This is a PURE retrieval function — no model calls are made.
    """
    _enforce_memory_limit()

    if repo_root is None:
        repo_root = Path.cwd()

    coll = (collection or "all").lower()
    if coll not in _VALID_COLLECTIONS:
        return (
            f'[RETRIEVED CONTEXT — query: "{query}" — error: '
            f"unknown collection {coll!r}; valid: {sorted(_VALID_COLLECTIONS)}]"
        )

    top_k = max(1, min(top_k, MAX_DOCS_PER_COLLECTION))
    max_chars = max(100, min(max_chars, MAX_OUTPUT_CHARS))

    # Load corpus documents for the requested collection(s)
    docs: list[tuple[str, str]] = []
    if coll in ("failures", "all"):
        docs.extend(_load_failures(repo_root))
    if coll in ("transcripts", "all"):
        docs.extend(_load_transcripts(repo_root))
    if coll in ("specs", "all"):
        docs.extend(_load_specs(repo_root))

    if not docs:
        scope_hint = (
            "datum corpus ingest"
            if coll == "all"
            else f"datum corpus ingest --collection {coll}"
        )
        return (
            f'[RETRIEVED CONTEXT — query: "{query}" — corpus empty for '
            f'collection "{coll}"; run: {scope_hint}]'
        )

    results = _tfidf_retrieve(docs, query, top_k)
    total_found = len(docs)

    return _render_results(results, query, total_found, top_k, max_chars)
