"""Semantic memory extraction using MLX embeddings.

Replaces regex pattern matching with cosine similarity against seed queries.
Uses Jina Embeddings v5 via MLX for Apple Silicon native inference.
Falls back to regex extraction if MLX or the model aren't available.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

EMBED_DIM = 256  # Matryoshka truncation — 256 of 1024 dims
MODEL_ID = "jinaai/jina-embeddings-v5-text-small-retrieval-mlx"

SEED_QUERIES = {
    "high": [
        "user explicitly telling the agent to always do something or never do something",
        "user correcting the agent's behavior with a direct instruction",
        "user saying remember this rule for future sessions",
        "user setting a permanent preference or workflow requirement",
    ],
    "medium": [
        "user expressing frustration with how the agent handled something",
        "user pointing out a mistake the agent made",
        "user suggesting a different approach than what the agent chose",
        "user noting a friction point or annoyance in the workflow",
    ],
}

CONFIDENCE_THRESHOLD = {"high": 0.45, "medium": 0.35}


def _load_model(model_dir: Path | None = None):
    try:
        import mlx.core as mx
        from huggingface_hub import snapshot_download
        from tokenizers import Tokenizer
    except ImportError:
        return None

    if model_dir is None:
        try:
            model_dir = Path(snapshot_download(MODEL_ID, local_dir_use_symlinks=False))
        except Exception:
            return None

    tokenizer_path = model_dir / "tokenizer.json"
    weights_path = model_dir / "model.safetensors"

    if not tokenizer_path.exists() or not weights_path.exists():
        return None

    try:
        tokenizer = Tokenizer.from_file(str(tokenizer_path))
        weights = mx.load(str(weights_path))
        return {"tokenizer": tokenizer, "weights": weights, "mx": mx}
    except Exception:
        return None


def _embed_texts(model_bundle: dict, texts: list[str]) -> np.ndarray:
    mx = model_bundle["mx"]
    tokenizer = model_bundle["tokenizer"]
    weights = model_bundle["weights"]

    embeddings = []
    for text in texts:
        encoded = tokenizer.encode(text[:512])
        input_ids = mx.array([encoded.ids])

        embed_weight = weights.get(
            "model.embed_tokens.weight", weights.get("embed_tokens.weight")
        )
        if embed_weight is None:
            for k in weights:
                if "embed" in k and "weight" in k:
                    embed_weight = weights[k]
                    break

        if embed_weight is None:
            raise RuntimeError("Could not find embedding weights in model")

        token_embeds = embed_weight[input_ids]
        sentence_embed = mx.mean(token_embeds, axis=1).squeeze()
        embedding = np.array(sentence_embed.tolist())[:EMBED_DIM]
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        embeddings.append(embedding)

    return np.array(embeddings)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def _build_seed_embeddings(
    model_bundle: dict,
) -> dict[str, np.ndarray]:
    seeds = {}
    for confidence, queries in SEED_QUERIES.items():
        query_embeds = _embed_texts(model_bundle, queries)
        seeds[confidence] = query_embeds
    return seeds


def extract_semantic(
    transcript_path: Path,
    model_dir: Path | None = None,
    cache_path: Path | None = None,
) -> dict:
    """Extract memory candidates using semantic similarity.

    Returns dict with high_confidence, medium_confidence, and metadata.
    Falls back to regex extraction if MLX isn't available.
    """
    model_bundle = _load_model(model_dir)
    if model_bundle is None:
        from datum.memory_extract import _extract_from_transcript

        candidates = _extract_from_transcript(transcript_path)
        return {
            "method": "regex_fallback",
            "high_confidence": [c for c in candidates if c["confidence"] == "high"],
            "medium_confidence": [c for c in candidates if c["confidence"] == "medium"],
            "total": len(candidates),
        }

    seed_embeds = _build_seed_embeddings(model_bundle)

    user_messages = _extract_user_messages(transcript_path)
    if not user_messages:
        return {
            "method": "semantic",
            "high_confidence": [],
            "medium_confidence": [],
            "total": 0,
        }

    message_texts = [m["text"] for m in user_messages]
    message_embeds = _embed_texts(model_bundle, message_texts)

    high_candidates = []
    medium_candidates = []

    for i, (msg, embed) in enumerate(zip(user_messages, message_embeds)):
        best_high = max(_cosine_similarity(embed, seed) for seed in seed_embeds["high"])
        best_medium = max(
            _cosine_similarity(embed, seed) for seed in seed_embeds["medium"]
        )

        if best_high >= CONFIDENCE_THRESHOLD["high"]:
            high_candidates.append(
                {
                    "source_quote": msg["text"][:300],
                    "timestamp": msg.get("timestamp", ""),
                    "score": round(best_high, 3),
                    "suggested_type": "feedback",
                }
            )
        elif best_medium >= CONFIDENCE_THRESHOLD["medium"]:
            medium_candidates.append(
                {
                    "source_quote": msg["text"][:300],
                    "timestamp": msg.get("timestamp", ""),
                    "score": round(best_medium, 3),
                    "suggested_type": "feedback",
                }
            )

    high_candidates.sort(key=lambda c: c["score"], reverse=True)
    medium_candidates.sort(key=lambda c: c["score"], reverse=True)

    return {
        "method": "semantic",
        "model": MODEL_ID,
        "embed_dim": EMBED_DIM,
        "messages_scanned": len(user_messages),
        "high_confidence": high_candidates[:20],
        "medium_confidence": medium_candidates[:20],
        "total": len(high_candidates) + len(medium_candidates),
    }


def _extract_user_messages(transcript_path: Path) -> list[dict]:
    messages = []
    seen = set()

    with transcript_path.open(encoding="utf-8") as fh:
        for raw_line in fh:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                event = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            msg = event.get("message", {})
            if msg.get("role") not in ("human", "user"):
                continue

            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    c.get("text", "")
                    for c in content
                    if isinstance(c, dict) and c.get("type") == "text"
                )
            elif isinstance(content, str):
                text = content
            else:
                continue

            text = text.strip()
            if not text or len(text) < 10:
                continue

            # Skip system-injected content
            if any(
                marker in text
                for marker in (
                    "Base directory for this skill:",
                    "system-reminder",
                    "task-notification",
                    "Tool loaded.",
                )
            ):
                continue

            dedup_key = text[:80]
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            messages.append({"text": text, "timestamp": event.get("timestamp", "")})

    return messages


def main() -> None:
    if len(sys.argv) < 2:
        print(
            "Usage: memory_semantic.py <transcript.jsonl> [--model-dir <path>]",
            file=sys.stderr,
        )
        sys.exit(1)

    transcript = Path(sys.argv[1]).expanduser()
    model_dir = None
    if "--model-dir" in sys.argv:
        idx = sys.argv.index("--model-dir")
        model_dir = Path(sys.argv[idx + 1]).expanduser()

    result = extract_semantic(transcript, model_dir)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
