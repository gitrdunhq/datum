"""Semantic (RAG) skill selection (ADR-0033/0034). Tiered selector behind the PersonaRegistry port:
tags (purpose) → embeddings (domain fit) → [LLM, future]. The semantic adapter degrades to a
deterministic keyword match when the embedding backend isn't installed, so it's safe as the default.
"""

from __future__ import annotations

import importlib.util

import pytest

from datum_ax.contracts.persona import PersonaRegistry
from datum_ax.data.persona import PERSONA_REGISTRIES
from datum_ax.data.persona.file_registry import FilePersonaRegistry
from datum_ax.data.persona.semantic_registry import SemanticPersonaRegistry
from datum_ax.presentation.composition import _PACKAGED_PERSONA_ROOT, build_context_crane

_HAS_ST = importlib.util.find_spec("sentence_transformers") is not None


def _file() -> FilePersonaRegistry:
    return FilePersonaRegistry(root=_PACKAGED_PERSONA_ROOT)


def _semantic() -> SemanticPersonaRegistry:
    return SemanticPersonaRegistry(root=_PACKAGED_PERSONA_ROOT)


def test_file_match_skills_is_deterministic_keyword_tier():
    got = _file().match_skills("astro cloudflare pages d1 r2 worker", limit=1)
    assert [s.id for s in got] == ["web-cloudflare-engineer"]


def test_file_match_skills_picks_swift_for_ios():
    got = _file().match_skills("build an iOS macOS swift app with clean architecture", limit=1)
    assert got and got[0].id == "swift-clean-architecture"


def test_semantic_registry_satisfies_port_and_is_registered():
    assert isinstance(_semantic(), PersonaRegistry)
    assert "semantic" in PERSONA_REGISTRIES.keys()


def test_semantic_delegates_roles_skills_and_base():
    sem = _semantic()
    assert "Critical Collaborator" in sem.base_persona()
    assert sem.get_role("triage").id == "triage"
    assert {s.id for s in sem.select_skills(("planning",))} >= {"gitnexus-exploring"}


def test_semantic_degrades_to_deterministic_when_model_absent():
    # Whether or not sentence-transformers is installed, match_skills returns a sensible domain
    # skill — embeddings when present, keyword fallback otherwise. Never raises.
    got = _semantic().match_skills("aws cdk infrastructure typescript deployment", limit=1)
    assert got and got[0].id == "aws-infrastructure-engineer"


def test_crane_compose_system_lifts_query_matched_domain_skill():
    crane = build_context_crane()  # file registry by default in this env
    system = crane.compose_system(
        "green", query="iOS macOS swift app clean architecture @Observable"
    )
    assert "Swift Testing framework" in system  # swift domain skill body was lifted (not in BASE)
    # A green lane with no query lifts no domain skill.
    assert "Swift Testing framework" not in crane.compose_system("green")


@pytest.mark.skipif(not _HAS_ST, reason="sentence-transformers not installed")
def test_semantic_embedding_path_when_available():
    got = _semantic().match_skills("deploy an Astro site to Cloudflare with D1", limit=1)
    assert got and got[0].id == "web-cloudflare-engineer"
