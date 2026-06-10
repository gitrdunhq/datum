"""Failing tests for epic-26 config overlay template (task-004).

Properties covered:
  INV-001  — config.toml parsed by tomllib produces valid dict with [local_llm] and [multi_turn];
             no key contains a value matching (?i)(claude|anthropic|sonnet|opus|haiku)
  ISOL-001 — Config overlay MUST NOT contain any Claude/Anthropic model IDs (strictly-local guarantee)
  SEC-001  — No Claude, Anthropic, Sonnet, Opus, or Haiku model identifier anywhere in config
  COMPAT-003 — assets/config.toml.default MUST NOT be modified; enable_write_tools default stays false

RED phase: all tests MUST FAIL now because the template does not yet exist.

Decision note — max_tool_turns:
  `max_tool_turns` IS a recognized key in datum/local_llm.py. At line 909:
      max_turns = mt_config.get("max_tool_turns", 10) if mt_config.get("enable_tool_execution", ...) else ...
  It is NOT in MULTI_TURN_DEFAULTS (lines 52-76) but IS read via dict.get() with a default of 10.
  It also appears in assets/config.toml.default (line 188):
      max_tool_turns = 10
  Conclusion: max_tool_turns IS a recognized key and MUST be present in the config template with a
  finite positive integer value. Test 5 asserts it is present and finite.

Read tools (7 manifest tools, confirmed from scripts/lane-tools/manifest.toml):
  find_callers, filter_gitnexus_output, read_file, read_file_range, list_dir, grep_search, run_command

Write tools (3 from WRITE_TOOLS frozenset in datum/local_llm.py:770-776):
  write_to_file, replace_file_content, multi_replace_file_content

Total allowed_tools count: 10
"""

import re
import tomllib
from pathlib import Path

import pytest

# ── Path constants ────────────────────────────────────────────────────────────

DATUM_ROOT = Path(__file__).resolve().parent.parent

CONFIG_TEMPLATE = (
    DATUM_ROOT
    / "docs"
    / "epics"
    / "datum"
    / "epic-26"
    / "bootstrap"
    / "templates"
    / "config.toml"
)

DATUM_CONFIG_DEFAULT = DATUM_ROOT / "assets" / "config.toml.default"

# ── Expected values ───────────────────────────────────────────────────────────

EXPECTED_MODEL = "mlx-community/Qwen3-30B-A3B-8bit"
EXPECTED_FAST_MODEL = "mlx-community/Llama-3.1-8B-Instruct-4bit"
EXPECTED_OMLX_URL = "http://localhost:12200"
EXPECTED_HF_CACHE_DIR = "/Volumes/Extra/mlx-models"

# All 7 manifest read tools (scripts/lane-tools/manifest.toml)
READ_TOOLS = {
    "find_callers",
    "filter_gitnexus_output",
    "read_file",
    "read_file_range",
    "list_dir",
    "grep_search",
    "run_command",
}

# 3 write tools (datum/local_llm.py WRITE_TOOLS frozenset)
WRITE_TOOLS = {
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
}

EXPECTED_ALLOWED_TOOLS = READ_TOOLS | WRITE_TOOLS  # 10 total

# Pattern that must never appear anywhere in the config (case-insensitive)
CLOUD_LLM_PATTERN = re.compile(r"claude|anthropic|sonnet|opus|haiku", re.IGNORECASE)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _load_config() -> dict:
    """Parse the config template with tomllib, with a clear message on missing file."""
    if not CONFIG_TEMPLATE.exists():
        pytest.fail(
            f"Config template not found at {CONFIG_TEMPLATE}. "
            "GREEN agent must create docs/epics/datum/epic-26/bootstrap/templates/config.toml "
            "before this test can pass."
        )
    with CONFIG_TEMPLATE.open("rb") as fh:
        return tomllib.load(fh)


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_config_template_file_exists():
    """Test 1: The config template file exists at the expected bootstrap path.

    Property: INV-001 (config.toml parseable), SEC-001 (file must exist to audit)
    """
    assert CONFIG_TEMPLATE.exists(), (
        f"Config template missing: {CONFIG_TEMPLATE}\n"
        "Create docs/epics/datum/epic-26/bootstrap/templates/config.toml"
    )


def test_local_llm_section_values():
    """Test 2: [local_llm] section has correct model tiers, omlx URL, hf_cache_dir, and enabled=true.

    Property: INV-001, ISOL-001 (local models only — no cloud IDs), SEC-001
    """
    cfg = _load_config()
    ll = cfg.get("local_llm", {})

    assert (
        ll.get("enabled") is True
    ), f"[local_llm] enabled must be true, got: {ll.get('enabled')!r}"
    assert (
        ll.get("model") == EXPECTED_MODEL
    ), f"[local_llm] model must be {EXPECTED_MODEL!r}, got: {ll.get('model')!r}"
    assert (
        ll.get("fast_model") == EXPECTED_FAST_MODEL
    ), f"[local_llm] fast_model must be {EXPECTED_FAST_MODEL!r}, got: {ll.get('fast_model')!r}"
    assert (
        ll.get("omlx_url") == EXPECTED_OMLX_URL
    ), f"[local_llm] omlx_url must be {EXPECTED_OMLX_URL!r}, got: {ll.get('omlx_url')!r}"

    hf_cache = ll.get("hf_cache_dir", "")
    assert (
        EXPECTED_HF_CACHE_DIR in hf_cache
    ), f"[local_llm] hf_cache_dir must point at {EXPECTED_HF_CACHE_DIR!r}, got: {hf_cache!r}"


def test_multi_turn_section_values():
    """Test 3: [multi_turn] section has enabled=true, enable_tool_execution=true, enable_write_tools=true.

    Property: INV-001, ISOL-001
    """
    cfg = _load_config()
    mt = cfg.get("multi_turn", {})

    assert (
        mt.get("enabled") is True
    ), f"[multi_turn] enabled must be true, got: {mt.get('enabled')!r}"
    assert (
        mt.get("enable_tool_execution") is True
    ), f"[multi_turn] enable_tool_execution must be true, got: {mt.get('enable_tool_execution')!r}"
    assert (
        mt.get("enable_write_tools") is True
    ), f"[multi_turn] enable_write_tools must be true, got: {mt.get('enable_write_tools')!r}"


def test_allowed_tools_exact_set():
    """Test 4: allowed_tools contains exactly all 7 read tools + 3 write tools = 10 tools total.

    The 7 read tools are the full manifest set: find_callers, filter_gitnexus_output,
    read_file, read_file_range, list_dir, grep_search, run_command.
    The 3 write tools are: write_to_file, replace_file_content, multi_replace_file_content.

    Note: AC5.2 originally said "9 read tools" but research findings (TASKS.md task-004)
    corrected this to 7 — the manifest has exactly 7 tools. Use 7 read tools.

    Property: INV-001, ISOL-001
    """
    cfg = _load_config()
    mt = cfg.get("multi_turn", {})
    allowed = mt.get("allowed_tools")

    assert isinstance(
        allowed, list
    ), f"[multi_turn] allowed_tools must be a list, got: {type(allowed).__name__}"

    allowed_set = set(allowed)

    missing_read = READ_TOOLS - allowed_set
    assert (
        not missing_read
    ), f"[multi_turn] allowed_tools is missing read tools: {sorted(missing_read)}"

    missing_write = WRITE_TOOLS - allowed_set
    assert (
        not missing_write
    ), f"[multi_turn] allowed_tools is missing write tools: {sorted(missing_write)}"

    extra = allowed_set - EXPECTED_ALLOWED_TOOLS
    assert (
        not extra
    ), f"[multi_turn] allowed_tools contains unexpected tool names: {sorted(extra)}"

    assert len(allowed) == 10, (
        f"[multi_turn] allowed_tools must have exactly 10 entries (7 read + 3 write), "
        f"got {len(allowed)}: {sorted(allowed)}"
    )


def test_budget_caps_finite_positive():
    """Test 5: Budget caps max_turns, timeout_s, and max_tool_turns are finite positive integers.

    max_tool_turns IS a recognized key in datum/local_llm.py (line 909):
        mt_config.get("max_tool_turns", 10)
    It also appears in assets/config.toml.default line 188.
    Therefore it MUST be present and set to a finite positive integer.

    Property: INV-001, SAFE-004 (M1 driver never stalls — budget caps enforce termination)
    """
    cfg = _load_config()
    mt = cfg.get("multi_turn", {})

    for key in ("max_turns", "timeout_s", "max_tool_turns"):
        val = mt.get(key)
        assert (
            val is not None
        ), f"[multi_turn] {key!r} is required but absent from the config template"
        assert isinstance(
            val, int
        ), f"[multi_turn] {key!r} must be an integer, got: {type(val).__name__} = {val!r}"
        assert val > 0, f"[multi_turn] {key!r} must be a positive integer, got: {val!r}"


def test_strictly_local_no_cloud_model_ids():
    """Test 6: The entire config file text contains no case-insensitive match for
    claude, anthropic, sonnet, opus, or haiku.

    This enforces the strictly-local guarantee — no cloud LLM provider identifiers
    may appear anywhere in any config value, key, or comment.

    Property: INV-001 (regex (?i)(claude|anthropic|sonnet|opus|haiku)),
              ISOL-001 (strictly-local guarantee),
              SEC-001 (security/isolation boundary preventing accidental cloud API calls)
    """
    if not CONFIG_TEMPLATE.exists():
        pytest.fail(
            f"Config template not found at {CONFIG_TEMPLATE}. "
            "Cannot audit for cloud model IDs without the file."
        )

    raw_text = CONFIG_TEMPLATE.read_text(encoding="utf-8")
    matches = CLOUD_LLM_PATTERN.findall(raw_text)

    assert not matches, (
        f"Config template contains {len(matches)} forbidden cloud model identifier(s): "
        f"{matches!r}\n"
        f"Path: {CONFIG_TEMPLATE}\n"
        f"The strictly-local guarantee (ISOL-001, SEC-001) forbids any reference to "
        f"claude, anthropic, sonnet, opus, or haiku in config.toml."
    )


def test_datum_config_default_not_modified():
    """Test 7 (COMPAT-003): assets/config.toml.default still has enable_write_tools = false.

    The config overlay template enables write tools — it must NOT bleed into the
    default config shipped with the datum repo.

    Property: COMPAT-003
    """
    assert (
        DATUM_CONFIG_DEFAULT.exists()
    ), f"assets/config.toml.default not found at {DATUM_CONFIG_DEFAULT}"
    with DATUM_CONFIG_DEFAULT.open("rb") as fh:
        default_cfg = tomllib.load(fh)

    mt_default = default_cfg.get("multi_turn", {})
    assert mt_default.get("enable_write_tools") is False, (
        f"assets/config.toml.default [multi_turn] enable_write_tools must remain false "
        f"(COMPAT-003), got: {mt_default.get('enable_write_tools')!r}\n"
        f"Do NOT modify assets/config.toml.default — only the overlay template enables write tools."
    )
