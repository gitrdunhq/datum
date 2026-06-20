"""Imported skill gold mine (ADR-0033) — the GitNexus code-intelligence suite + bug-hunt, copied from
datum into packaged `datum_ax/personas/skills/` and exposed deterministically via the registry."""

from __future__ import annotations

from datum_ax.contracts.persona import Skill
from datum_ax.presentation.composition import build_persona_registry

_EXPECTED = {
    "gitnexus-exploring",
    "gitnexus-debugging",
    "gitnexus-impact-analysis",
    "gitnexus-refactoring",
    "gitnexus-guide",
    "gitnexus-cli",
    "gitnexus-bug-hunt",
}


def test_all_imported_skills_are_registered():
    reg = build_persona_registry()
    got = {s.id for s in reg.select_skills(("code-intelligence",))}
    assert _EXPECTED <= got


def test_imported_skill_has_body_and_metadata():
    reg = build_persona_registry()
    skill = reg.get_skill("gitnexus-bug-hunt")
    assert isinstance(skill, Skill)
    assert skill.name  # carried from frontmatter
    assert "GitNexus" in skill.instructions  # the body survived the import
    assert "gitnexus" in skill.tool_refs
    assert "code-intelligence" in skill.scope_tags


def test_specific_tags_select_subset():
    reg = build_persona_registry()
    refactor = {s.id for s in reg.select_skills(("refactor",))}
    assert "gitnexus-refactoring" in refactor
    assert "gitnexus-impact-analysis" in refactor
    assert "gitnexus-debugging" not in refactor  # not tagged 'refactor'
