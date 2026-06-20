"""Fail-soft artifact loading (review #3/#4/#6): one malformed file is logged and skipped, never
aborts the whole registry; robust frontmatter parsing."""

from __future__ import annotations

import pytest

from datum_ax.contracts.persona import PersonaNotFoundError, SkillDelivery
from datum_ax.data._artifacts import parse_frontmatter
from datum_ax.data.persona.file_registry import FilePersonaRegistry
from datum_ax.data.rules.file_registry import FileRuleRegistry


def test_parse_frontmatter_treats_hr_opening_body_as_body():
    text = "---\n\nA thematic break, not frontmatter.\n\n---\n\nmore body"
    meta, body = parse_frontmatter(text)
    assert meta == {}  # not a YAML mapping → all body, no crash
    assert "thematic break" in body


def test_bad_role_is_skipped_good_one_still_loads(tmp_path):
    roles = tmp_path / "roles"
    roles.mkdir()
    (roles / "good.md").write_text(
        "---\nname: Good\nmodel_role: executor\n---\nbody", encoding="utf-8"
    )
    (roles / "bad.md").write_text("---\nname: Bad\n---\nno model_role", encoding="utf-8")
    reg = FilePersonaRegistry(root=str(tmp_path))
    assert reg.get_role("good").model_role.value == "executor"
    with pytest.raises(PersonaNotFoundError):
        reg.get_role("bad")  # skipped, not fatal


def test_yaml_coerced_delivery_does_not_crash(tmp_path):
    skills = tmp_path / "skills"
    skills.mkdir()
    # `delivery: true` would YAML-coerce to a bool; must not crash the load.
    (skills / "s.md").write_text("---\nname: S\ndelivery: true\n---\nhow to s", encoding="utf-8")
    reg = FilePersonaRegistry(root=str(tmp_path))
    assert reg.get_skill("s").delivery is SkillDelivery.INLINE  # safe default


def test_one_bad_rule_is_skipped_not_fatal(tmp_path):
    (tmp_path / "ok.md").write_text(
        "---\nkind: discipline\nscope_tags: [code]\nevidence_refs: [x]\n---\nok rule",
        encoding="utf-8",
    )
    (tmp_path / "broken.md").write_text(
        "---\nversion: not-a-number\n---\nbroken rule", encoding="utf-8"
    )
    reg = FileRuleRegistry(root=str(tmp_path))
    assert reg.get_rule("ok").statement == "ok rule"
    assert "broken" not in reg.all_rule_ids()
