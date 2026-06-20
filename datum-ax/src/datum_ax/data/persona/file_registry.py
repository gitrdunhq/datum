"""FilePersonaRegistry (data tier) — loads Roles + Skills from markdown + YAML frontmatter on disk
(ADR-0033). Persona-compatible format so an external registry's files could be imported later.

Layout: ``<root>/roles/*.md`` and ``<root>/skills/*.md``. Resolution is deterministic — `role_for`
picks the highest version (ties broken by id); `select_skills` returns tag-matched skills sorted by
id. No embeddings: semantic matching, if ever added, is a separate cognition-side adapter.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from datum_ax.contracts.inference import ModelRole
from datum_ax.contracts.persona import PersonaNotFoundError, Role, Skill
from datum_ax.data.persona import PERSONA_REGISTRIES
from datum_ax.observability import get_logger

logger = get_logger(__name__)


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split ``---\\n<yaml>\\n---\\n<body>`` into (metadata, body). No frontmatter → ({}, text)."""
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            meta = yaml.safe_load(parts[1]) or {}
            if not isinstance(meta, dict):
                raise ValueError("frontmatter must be a mapping")
            return meta, parts[2].lstrip("\n")
    return {}, text


class FilePersonaRegistry:
    """Implements the ``PersonaRegistry`` port over a directory of markdown artifacts."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self._roles: dict[str, Role] = {}
        self._skills: dict[str, Skill] = {}
        self._base = ""
        self._load()

    def base_persona(self) -> str:
        """The foundational system prefix shared by every role (BASE_PERSONA.md); '' if absent."""
        return self._base

    def _load(self) -> None:
        base_file = self.root / "BASE_PERSONA.md"
        if base_file.exists():
            self._base = base_file.read_text(encoding="utf-8").strip()
        # id = filename stem (canonical, filesystem-native — avoids YAML scalar coercion of the key,
        # e.g. an unquoted `true`/`1` in frontmatter). Frontmatter carries the display + routing fields.
        # rglob so artifacts can be grouped in subfolders (skills/code-intelligence, skills/domain, …)
        # purely for organization — the stem id and tags drive resolution, not the path.
        for path in sorted((self.root / "roles").rglob("*.md")):
            meta, body = _parse_frontmatter(path.read_text(encoding="utf-8"))
            role = Role(
                id=path.stem,
                name=str(meta.get("name") or path.stem),
                description=str(meta.get("description") or ""),
                model_role=ModelRole(meta["model_role"]),
                body=body,
                version=int(meta.get("version", 1)),
                scope_tags=tuple(str(t) for t in (meta.get("scope_tags") or ())),
            )
            self._roles[role.id] = role
        for path in sorted((self.root / "skills").rglob("*.md")):
            meta, body = _parse_frontmatter(path.read_text(encoding="utf-8"))
            skill = Skill(
                id=path.stem,
                name=str(meta.get("name") or path.stem),
                description=str(meta.get("description") or ""),
                instructions=body,
                tool_refs=tuple(str(t) for t in (meta.get("tool_refs") or ())),
                version=int(meta.get("version", 1)),
                scope_tags=tuple(str(t) for t in (meta.get("scope_tags") or ())),
            )
            self._skills[skill.id] = skill
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


@PERSONA_REGISTRIES.register("file")
def _build(**kwargs: Any) -> FilePersonaRegistry:
    return FilePersonaRegistry(**kwargs)
