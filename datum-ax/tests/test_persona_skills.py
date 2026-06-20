"""Imported skill gold mine (ADR-0033) — the GitNexus code-intelligence suite + bug-hunt, copied from
datum into packaged `datum_ax/personas/skills/` and exposed deterministically via the registry."""

from __future__ import annotations

from datum_ax.contracts.persona import Skill
from datum_ax.presentation.composition import build_context_crane, build_persona_registry

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


def test_planning_tasks_lift_only_planning_skills():
    reg = build_persona_registry()
    planning = {s.id for s in reg.select_skills(("planning",))}
    assert "gitnexus-exploring" in planning
    assert "gitnexus-impact-analysis" in planning
    # Troubleshooting skills are NOT lifted for a planning task.
    assert "gitnexus-debugging" not in planning
    assert "gitnexus-bug-hunt" not in planning


def test_troubleshooting_tasks_lift_only_troubleshooting_skills():
    reg = build_persona_registry()
    trouble = {s.id for s in reg.select_skills(("troubleshooting",))}
    assert trouble == {"gitnexus-debugging", "gitnexus-bug-hunt"}


def test_routine_lane_lifts_no_gitnexus():
    # An untagged/implementation lane pulls nothing — the crane lifts only what's needed.
    reg = build_persona_registry()
    assert reg.select_skills(()) == ()
    assert reg.select_skills(("implementation",)) == ()


def test_base_persona_is_loaded_and_prepended():
    reg = build_persona_registry()
    assert "Critical Collaborator" in reg.base_persona()  # the foundational voice
    system = build_context_crane().compose_system("triage")
    assert "Critical Collaborator" in system  # BASE_PERSONA prepended
    assert system.index("Critical Collaborator") < system.index("datum router")  # base before role


def test_distilled_domain_skills_are_registered():
    reg = build_persona_registry()
    domain = {s.id for s in reg.select_skills(("domain",))}
    assert {
        "swift-clean-architecture",
        "aws-infrastructure-engineer",
        "web-cloudflare-engineer",
    } <= domain


def test_planner_system_folds_in_planning_skills_only():
    crane = build_context_crane()
    planning = crane.compose_system("lane-plan", scope_tags=("planning",))
    assert "Task decomposer" in planning  # the lane-plan role body
    assert "GitNexus" in planning  # a planning skill was lifted in

    # A routine implementation lift carries the role body but no gitnexus skill.
    routine = crane.compose_system("green", scope_tags=())
    assert "GitNexus" not in routine
