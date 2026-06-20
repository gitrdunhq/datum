"""ContextCrane persona composition (ADR-0033/0030) — the crane composes a lane's [System] prefix
from a registry-resolved Role + tag-selected Skills, then assembles/prunes/budgets as usual."""

from __future__ import annotations

import pytest

from datum_ax.contracts.inference import ModelRole, TokenBudget
from datum_ax.contracts.persona import PersonaNotFoundError, Role, Skill
from datum_ax.core.orchestration.crane import ContextCrane
from datum_ax.data.context.adapters import (
    Context7DocContext,
    HeadroomNlCompressor,
    SerenaTokenSaveContext,
)
from datum_ax.data.context.dcp import DynamicContextPruner


class _FakePersona:
    """Minimal PersonaRegistry stand-in for crane composition tests."""

    def __init__(self, role: Role, skills: tuple[Skill, ...] = ()):
        self._role = role
        self._skills = skills

    def base_persona(self) -> str:
        return ""

    def get_role(self, role_id: str) -> Role:
        if role_id != self._role.id:
            raise PersonaNotFoundError(role_id)
        return self._role

    def role_for(self, model_role: ModelRole) -> Role:
        if model_role is not self._role.model_role:
            raise PersonaNotFoundError(str(model_role))
        return self._role

    def get_skill(self, skill_id: str) -> Skill:
        for s in self._skills:
            if s.id == skill_id:
                return s
        raise PersonaNotFoundError(skill_id)

    def select_skills(self, scope_tags: tuple[str, ...]) -> tuple[Skill, ...]:
        wanted = set(scope_tags)
        return tuple(s for s in self._skills if wanted.intersection(s.scope_tags))

    def match_skills(self, query: str, limit: int = 1, threshold: float = 0.3) -> tuple[Skill, ...]:
        return ()


def _crane_with(persona) -> ContextCrane:
    return ContextCrane(
        code_context=SerenaTokenSaveContext(),
        doc_context=Context7DocContext(),
        nl_compressor=HeadroomNlCompressor(),
        pruner=DynamicContextPruner(),
        budget=TokenBudget(max_input=100_000, max_output=4_000, window_target=120_000),
        persona=persona,
    )


def test_compose_system_includes_role_body_and_selected_skills():
    role = Role(id="triage", name="Triage", model_role=ModelRole.TRIAGE, body="ROLE_BODY")
    skill = Skill(id="run_tests", name="Run Tests", instructions="SKILL_INSTR", scope_tags=("py",))
    crane = _crane_with(_FakePersona(role, (skill,)))

    out = crane.compose_system("triage", scope_tags=("py",))
    assert "ROLE_BODY" in out
    assert "SKILL_INSTR" in out
    # Role body precedes skills (cache-stable ordering).
    assert out.index("ROLE_BODY") < out.index("SKILL_INSTR")


def test_compose_system_is_deterministic():
    role = Role(id="r", name="R", model_role=ModelRole.EXECUTOR, body="B")
    skills = (
        Skill(id="a", name="A", instructions="IA", scope_tags=("x",)),
        Skill(id="b", name="B", instructions="IB", scope_tags=("x",)),
    )
    crane = _crane_with(_FakePersona(role, skills))
    assert crane.compose_system("r", scope_tags=("x",)) == crane.compose_system(
        "r", scope_tags=("x",)
    )


def test_compose_system_without_skills_is_just_the_role():
    role = Role(id="r", name="R", model_role=ModelRole.EXECUTOR, body="ONLY_BODY")
    crane = _crane_with(_FakePersona(role))
    assert crane.compose_system("r").strip() == "ONLY_BODY"


def test_compose_system_requires_a_registry():
    crane = _crane_with(None)
    with pytest.raises(PersonaNotFoundError):
        crane.compose_system("r")
