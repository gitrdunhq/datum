"""SemanticPersonaRegistry (data tier) — RAG skill selection over a FilePersonaRegistry (ADR-0033/0034).

`match_skills` embeds the query and each skill's name+description (sentence-transformers, MiniLM by
default) and returns the nearest skills above a cosine threshold — deterministic given a pinned model
+ fixed corpus. Everything else (base persona, roles, tag-based `select_skills`) delegates to the
wrapped file registry. The embedding backend is an optional extra (`datum-ax[semantic]`); when it
isn't installed or the model can't load, `match_skills` degrades to the file registry's deterministic
keyword tier — so this adapter is always safe to use as the default.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from datum_ax.contracts.persona import Role, Skill
from datum_ax.data.persona import PERSONA_REGISTRIES
from datum_ax.data.persona.file_registry import FilePersonaRegistry
from datum_ax.observability import get_logger

logger = get_logger(__name__)


class SemanticPersonaRegistry:
    """Implements the `PersonaRegistry` port; adds embedding-based `match_skills`."""

    def __init__(self, root: str | Path, model_name: str = "all-MiniLM-L6-v2") -> None:
        self._inner = FilePersonaRegistry(root)
        self._model_name = model_name
        self._model: Any = None
        self._np: Any = None
        self._emb: Any = None
        self._corpus: tuple[Skill, ...] = ()
        self._loaded = False

    # --- delegated (deterministic) -------------------------------------------------------------
    def base_persona(self) -> str:
        return self._inner.base_persona()

    def get_role(self, role_id: str) -> Role:
        return self._inner.get_role(role_id)

    def role_for(self, model_role: Any) -> Role:
        return self._inner.role_for(model_role)

    def get_skill(self, skill_id: str) -> Skill:
        return self._inner.get_skill(skill_id)

    def select_skills(self, scope_tags: tuple[str, ...]) -> tuple[Skill, ...]:
        return self._inner.select_skills(scope_tags)

    # --- semantic (RAG) ------------------------------------------------------------------------
    def _ensure_model(self) -> bool:
        """Lazily load the embedding model + corpus embeddings. Returns False (and logs) if the
        optional backend is unavailable, so callers can degrade."""
        if self._loaded:
            return self._model is not None
        self._loaded = True
        try:
            import numpy as np
            from sentence_transformers import SentenceTransformer

            self._np = np
            self._model = SentenceTransformer(self._model_name)
            self._corpus = self._inner.all_skills()
            texts = [f"Skill: {s.name}\nPurpose: {s.description}" for s in self._corpus]
            self._emb = self._model.encode(texts, convert_to_numpy=True) if texts else None
        except Exception as exc:  # ImportError, model download failure, etc.
            logger.warning("semantic_persona_unavailable", error=str(exc), fallback="keyword")
            self._model = None
        return self._model is not None

    def match_skills(self, query: str, limit: int = 1, threshold: float = 0.3) -> tuple[Skill, ...]:
        if not self._ensure_model() or self._emb is None:
            return self._inner.match_skills(
                query, limit=limit, threshold=0.0
            )  # deterministic degrade
        qv = self._model.encode([query], convert_to_numpy=True)[0]
        qn = self._np.linalg.norm(qv) or 1.0
        scored = []
        for i, skill in enumerate(self._corpus):
            v = self._emb[i]
            cos = float(self._np.dot(qv, v) / (qn * (self._np.linalg.norm(v) or 1.0)))
            if cos >= threshold:
                scored.append((cos, skill.id, skill))
        scored.sort(key=lambda t: (-t[0], t[1]))
        return tuple(s for _, _, s in scored[:limit])


@PERSONA_REGISTRIES.register("semantic")
def _build(**kwargs: Any) -> SemanticPersonaRegistry:
    return SemanticPersonaRegistry(**kwargs)
