"""PersonaRegistry (ADR-0033) — Roles + Skills as versioned markdown+frontmatter artifacts behind a
port, resolved deterministically (no embeddings in the core path).

DPS-12 domains:
- Determinism (INVARIANT): same files + same query → same Role/Skill resolution, every call.
- Uniqueness (INVARIANT): a role id / skill id resolves to exactly one artifact.
- Availability (LIVENESS): a registered artifact is always retrievable; a missing one fails loudly.
"""

from __future__ import annotations

import pathlib
import tempfile

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from datum_ax.contracts.inference import ModelRole
from datum_ax.contracts.persona import (
    PersonaNotFoundError,
    PersonaRegistry,
    Role,
    Skill,
)
from datum_ax.data.persona.file_registry import FilePersonaRegistry


def _write_role(root: pathlib.Path, role_id: str, model_role: str, *, version: int = 1, tags=()):
    d = root / "roles"
    d.mkdir(parents=True, exist_ok=True)
    tags_yaml = "[" + ", ".join(tags) + "]"
    (d / f"{role_id}.md").write_text(
        f"---\nname: {role_id.title()}\ndescription: a {role_id} role\n"
        f"model_role: {model_role}\nversion: {version}\nscope_tags: {tags_yaml}\n---\n"
        f"You are the {role_id}.\n",
        encoding="utf-8",
    )


def _write_skill(root: pathlib.Path, skill_id: str, *, version: int = 1, tags=(), tools=()):
    d = root / "skills"
    d.mkdir(parents=True, exist_ok=True)
    tags_yaml = "[" + ", ".join(tags) + "]"
    tools_yaml = "[" + ", ".join(tools) + "]"
    (d / f"{skill_id}.md").write_text(
        f"---\nname: {skill_id.title()}\ndescription: a {skill_id} skill\n"
        f"version: {version}\nscope_tags: {tags_yaml}\ntool_refs: {tools_yaml}\n---\n"
        f"How to {skill_id}.\n",
        encoding="utf-8",
    )


def test_satisfies_persona_registry_port(tmp_path):
    _write_role(tmp_path, "executor", "executor")
    assert isinstance(FilePersonaRegistry(root=str(tmp_path)), PersonaRegistry)


def test_get_role_roundtrips(tmp_path):
    _write_role(tmp_path, "executor", "executor", tags=("python",))
    reg = FilePersonaRegistry(root=str(tmp_path))
    role = reg.get_role("executor")
    assert isinstance(role, Role)
    assert role.id == "executor"
    assert role.model_role is ModelRole.EXECUTOR
    assert role.scope_tags == ("python",)
    assert "You are the executor." in role.body


def test_role_for_resolves_by_model_role(tmp_path):
    _write_role(tmp_path, "triager", "triage")
    _write_role(tmp_path, "executor", "executor")
    reg = FilePersonaRegistry(root=str(tmp_path))
    assert reg.role_for(ModelRole.TRIAGE).id == "triager"
    assert reg.role_for(ModelRole.EXECUTOR).id == "executor"


def test_role_for_picks_highest_version_deterministically(tmp_path):
    _write_role(tmp_path, "exec_v1", "executor", version=1)
    _write_role(tmp_path, "exec_v2", "executor", version=3)
    reg = FilePersonaRegistry(root=str(tmp_path))
    assert reg.role_for(ModelRole.EXECUTOR).id == "exec_v2"


def test_get_skill_roundtrips(tmp_path):
    _write_skill(tmp_path, "run_tests", tags=("testing",), tools=("pytest",))
    reg = FilePersonaRegistry(root=str(tmp_path))
    skill = reg.get_skill("run_tests")
    assert isinstance(skill, Skill)
    assert skill.id == "run_tests"
    assert skill.tool_refs == ("pytest",)
    assert "How to run_tests." in skill.instructions


def test_select_skills_by_scope_tags_is_sorted_and_filtered(tmp_path):
    _write_skill(tmp_path, "b_skill", tags=("python",))
    _write_skill(tmp_path, "a_skill", tags=("python",))
    _write_skill(tmp_path, "rust_skill", tags=("rust",))
    reg = FilePersonaRegistry(root=str(tmp_path))
    selected = reg.select_skills(("python",))
    assert [s.id for s in selected] == ["a_skill", "b_skill"]  # filtered + deterministic order


def test_missing_role_and_skill_raise(tmp_path):
    (tmp_path / "roles").mkdir()
    reg = FilePersonaRegistry(root=str(tmp_path))
    with pytest.raises(PersonaNotFoundError):
        reg.get_role("nope")
    with pytest.raises(PersonaNotFoundError):
        reg.get_skill("nope")
    with pytest.raises(PersonaNotFoundError):
        reg.role_for(ModelRole.EXECUTOR)


def test_select_skills_empty_when_no_tag_match(tmp_path):
    _write_skill(tmp_path, "py", tags=("python",))
    reg = FilePersonaRegistry(root=str(tmp_path))
    assert reg.select_skills(("go",)) == ()


class TestProperties:
    @settings(max_examples=30, deadline=None)
    @given(
        ids=st.lists(
            st.text(st.characters(min_codepoint=97, max_codepoint=122), min_size=1, max_size=8),
            min_size=1,
            max_size=5,
            unique=True,
        )
    )
    def test_select_is_deterministic(self, ids):
        """Determinism INVARIANT: repeated selection over the same registry is identical."""
        with tempfile.TemporaryDirectory() as tmp:  # isolate each Hypothesis example
            root = pathlib.Path(tmp)
            for i in ids:
                _write_skill(root, i, tags=("python",))
            reg = FilePersonaRegistry(root=str(root))
            first = [s.id for s in reg.select_skills(("python",))]
            second = [s.id for s in reg.select_skills(("python",))]
            assert first == second == sorted(ids)
