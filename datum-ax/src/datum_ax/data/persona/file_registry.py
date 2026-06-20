"""FilePersonaRegistry (data tier) — loads Roles + Skills from markdown + YAML frontmatter on disk
(ADR-0033). Persona-compatible format so an external registry's files could be imported later.

Layout: ``<root>/roles/*.md`` and ``<root>/skills/*.md``. Resolution is deterministic — `role_for`
picks the highest version (ties broken by id); `select_skills` returns tag-matched skills sorted by
id. No embeddings: semantic matching, if ever added, is a separate cognition-side adapter.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from datum_ax.contracts.inference import ModelRole
from datum_ax.contracts.persona import PersonaNotFoundError, Role, Skill, SkillDelivery
from datum_ax.data._artifacts import load_artifacts
from datum_ax.data.persona import PERSONA_REGISTRIES
from datum_ax.observability import get_logger

logger = get_logger(__name__)


def _tags(value: Any) -> tuple[str, ...]:
    return tuple(str(t) for t in (value or ()))


def _delivery(value: Any) -> SkillDelivery:
    # Lenient: only the exact "subagent" marker promotes a skill to a playbook; anything else
    # (including a YAML-coerced bool/int) safely defaults to inline rather than crashing the load.
    return (
        SkillDelivery.SUBAGENT if str(value).strip().lower() == "subagent" else SkillDelivery.INLINE
    )


def _role(stem: str, meta: dict[str, Any], body: str) -> Role:
    return Role(
        id=stem,
        name=str(meta.get("name") or stem),
        description=str(meta.get("description") or ""),
        model_role=ModelRole(meta["model_role"]),  # required — a role without it is skipped+logged
        body=body,
        version=int(meta.get("version", 1)),
        scope_tags=_tags(meta.get("scope_tags")),
    )


def _skill(stem: str, meta: dict[str, Any], body: str) -> Skill:
    return Skill(
        id=stem,
        name=str(meta.get("name") or stem),
        description=str(meta.get("description") or ""),
        instructions=body,
        tool_refs=_tags(meta.get("tool_refs")),
        version=int(meta.get("version", 1)),
        scope_tags=_tags(meta.get("scope_tags")),
        delivery=_delivery(meta.get("delivery")),
    )


class FilePersonaRegistry:
    """Implements the ``PersonaRegistry`` port over a directory of markdown artifacts."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self._base = ""
        self._roles: dict[str, Role] = {}
        self._skills: dict[str, Skill] = {}
        self._load()

    def base_persona(self) -> str:
        """The foundational system prefix shared by every role (BASE_PERSONA.md); '' if absent."""
        return self._base

    def _load(self) -> None:
        base_file = self.root / "BASE_PERSONA.md"
        if base_file.exists():
            self._base = base_file.read_text(encoding="utf-8").strip()
        # id = filename stem (canonical, filesystem-native). load_artifacts rglobs each dir and
        # logs+skips any malformed file, so one bad artifact can't take down the registry.
        self._roles = load_artifacts([self.root / "roles"], _role)
        self._skills = load_artifacts([self.root / "skills"], _skill)
        logger.debug("persona_loaded", roles=len(self._roles), skills=len(self._skills))

    def get_role(self, role_id: str) -> Role:
        try:
            return self._roles[role_id]
        except KeyError:
            raise PersonaNotFoundError(
                f"no role {role_id!r}; known: {sorted(self._roles)}"
            ) from None

    def role_for(self, model_role: ModelRole) -> Role:
        # Deterministic: highest version wins, ties broken by id.
        candidates = [r for r in self._roles.values() if r.model_role is model_role]
        if not candidates:
            raise PersonaNotFoundError(f"no role bound to model_role {model_role.value!r}")
        return max(candidates, key=lambda r: (r.version, r.id))

    def get_skill(self, skill_id: str) -> Skill:
        try:
            return self._skills[skill_id]
        except KeyError:
            raise PersonaNotFoundError(
                f"no skill {skill_id!r}; known: {sorted(self._skills)}"
            ) from None

    def select_skills(self, scope_tags: tuple[str, ...]) -> tuple[Skill, ...]:
        wanted = set(scope_tags)
        matched = [s for s in self._skills.values() if wanted.intersection(s.scope_tags)]
        return tuple(sorted(matched, key=lambda s: s.id))

    def all_skills(self) -> tuple[Skill, ...]:
        """Every skill, id-sorted (the corpus a semantic adapter embeds over)."""
        return tuple(sorted(self._skills.values(), key=lambda s: s.id))

    def match_skills(self, query: str, limit: int = 1, threshold: float = 0.0) -> tuple[Skill, ...]:
        """Deterministic keyword-overlap match against name+description+tags — the no-dependency
        fallback tier under the semantic adapter (ADR-0034). Higher overlap wins; ties by id."""
        q = set(re.findall(r"[a-z0-9]+", query.lower()))
        if not q:
            return ()
        scored = []
        for s in self.all_skills():
            text = f"{s.name} {s.description} {' '.join(s.scope_tags)}".lower()
            words = set(re.findall(r"[a-z0-9]+", text))
            overlap = len(q & words) / len(q)
            if overlap > threshold:
                scored.append((overlap, s.id, s))
        scored.sort(key=lambda t: (-t[0], t[1]))
        return tuple(s for _, _, s in scored[:limit])


@PERSONA_REGISTRIES.register("file")
def _build(**kwargs: Any) -> FilePersonaRegistry:
    return FilePersonaRegistry(**kwargs)
