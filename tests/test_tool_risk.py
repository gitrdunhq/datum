"""Tests for datum.tool_risk — tool risk-class metadata + retry safety (#77).

TDD: this file is the specification. Implementation must make all of these
green without modifying the tests.

Covers:
  - ToolRiskClass enum completeness and ordering
  - TOOL_RISK_MAP coverage: every TOOL_CATALOG key is classified
  - classify_tool: known tool → correct class; unknown tool → destructive
  - retry_safe: read_only and compute_only are retryable; write_local,
    process_execution, and destructive are NOT
  - TOOL_CATALOG 3-tuple integration: third element is a ToolRiskClass
  - Budget.max_retries_per_call is respected downstream (guard not here,
    but we verify the Budget field exists so the wiring point is clear)
"""

import pytest

from datum.agent_loop import TOOL_CATALOG
from datum.tool_risk import TOOL_RISK_MAP, ToolRiskClass, classify_tool, retry_safe

# ── ToolRiskClass enum ────────────────────────────────────────────────────


class TestToolRiskClassEnum:
    def test_all_five_members_exist(self):
        members = {m.value for m in ToolRiskClass}
        assert members == {
            "read_only",
            "compute_only",
            "write_local",
            "process_execution",
            "destructive",
        }

    def test_members_are_strings(self):
        for member in ToolRiskClass:
            assert isinstance(member.value, str)

    def test_enum_is_importable_from_schemas(self):
        """ToolRiskClass must also be importable from datum.schemas."""
        from datum.schemas import ToolRiskClass as TRC  # noqa: F401

        assert TRC.read_only.value == "read_only"


# ── TOOL_RISK_MAP coverage ────────────────────────────────────────────────


class TestToolRiskMap:
    def test_every_tool_catalog_key_is_classified(self):
        """No catalog tool may be missing a risk class."""
        for tool_name in TOOL_CATALOG:
            assert tool_name in TOOL_RISK_MAP, (
                f"TOOL_CATALOG tool '{tool_name}' not in TOOL_RISK_MAP — "
                "add it before merging"
            )

    def test_all_map_values_are_tool_risk_class_instances(self):
        for tool_name, risk in TOOL_RISK_MAP.items():
            assert isinstance(
                risk, ToolRiskClass
            ), f"TOOL_RISK_MAP[{tool_name!r}] is {risk!r}, not a ToolRiskClass"


# ── classify_tool ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "tool_name,expected",
    [
        # read-only: no side effects
        ("read_file", ToolRiskClass.read_only),
        ("read_file_range", ToolRiskClass.read_only),
        ("list_dir", ToolRiskClass.read_only),
        ("grep_search", ToolRiskClass.read_only),
        ("find_callers", ToolRiskClass.read_only),
        ("filter_gitnexus_output", ToolRiskClass.read_only),
        ("read_todos", ToolRiskClass.read_only),
        # write_local: idempotent writes to the working tree
        ("write_to_file", ToolRiskClass.write_local),
        ("replace_file_content", ToolRiskClass.write_local),
        ("multi_replace_file_content", ToolRiskClass.write_local),
        ("write_todos", ToolRiskClass.write_local),
        # process_execution: runs an external process
        ("run_command", ToolRiskClass.process_execution),
    ],
)
def test_classify_tool_known_tools(tool_name, expected):
    assert classify_tool(tool_name) == expected


def test_classify_tool_unknown_defaults_to_destructive():
    """Unknown tools are classified as destructive — fail-safe."""
    assert classify_tool("definitely_not_a_real_tool") == ToolRiskClass.destructive
    assert classify_tool("") == ToolRiskClass.destructive
    assert classify_tool("rm_everything") == ToolRiskClass.destructive


# ── retry_safe ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "risk_class,expected",
    [
        (ToolRiskClass.read_only, True),
        (ToolRiskClass.compute_only, True),
        (ToolRiskClass.write_local, False),
        (ToolRiskClass.process_execution, False),
        (ToolRiskClass.destructive, False),
    ],
)
def test_retry_safe_by_risk_class(risk_class, expected):
    assert retry_safe(risk_class) == expected


def test_retry_safe_rejects_non_enum():
    with pytest.raises(TypeError):
        retry_safe("read_only")  # type: ignore[arg-type]


# ── TOOL_CATALOG 3-tuple integration ─────────────────────────────────────


class TestToolCatalogIntegration:
    def test_every_catalog_entry_is_a_3_tuple(self):
        """After wiring, each TOOL_CATALOG value is (sig, desc, ToolRiskClass)."""
        for tool_name, entry in TOOL_CATALOG.items():
            assert len(entry) == 3, (
                f"TOOL_CATALOG[{tool_name!r}] has {len(entry)} elements, expected 3 "
                "(sig, desc, ToolRiskClass)"
            )
            sig, desc, risk = entry
            assert isinstance(sig, str), f"entry[0] must be str, got {type(sig)}"
            assert isinstance(desc, str), f"entry[1] must be str, got {type(desc)}"
            assert isinstance(
                risk, ToolRiskClass
            ), f"entry[2] must be ToolRiskClass, got {type(risk)}"

    def test_catalog_risk_classes_match_risk_map(self):
        """TOOL_CATALOG third element must equal TOOL_RISK_MAP[name]."""
        for tool_name, (_, _, risk) in TOOL_CATALOG.items():
            assert (
                risk == TOOL_RISK_MAP[tool_name]
            ), f"TOOL_CATALOG[{tool_name!r}][2] != TOOL_RISK_MAP[{tool_name!r}]"

    def test_read_only_tools_are_retry_safe_via_catalog(self):
        """Convenience: tool_name → catalog risk → retry_safe (integration path)."""
        read_only_tools = ["read_file", "list_dir", "grep_search"]
        for name in read_only_tools:
            _, _, risk = TOOL_CATALOG[name]
            assert retry_safe(risk), f"{name} should be retry-safe"

    def test_write_and_exec_tools_are_not_retry_safe_via_catalog(self):
        not_safe = ["write_to_file", "replace_file_content", "run_command"]
        for name in not_safe:
            _, _, risk = TOOL_CATALOG[name]
            assert not retry_safe(risk), f"{name} should NOT be retry-safe"


# ── Budget integration point ──────────────────────────────────────────────


def test_budget_has_max_retries_per_call():
    """Budget.max_retries_per_call exists — the wiring point for risk-gated retry."""
    from datum.budget import Budget

    b = Budget()
    assert hasattr(b, "max_retries_per_call")
    assert b.max_retries_per_call is not None
