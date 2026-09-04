"""Every ``agents/*.md`` is a well-formed, cost-bounded Claude Code agent (#368).

Evidence from a 463-call epic run: each sub-agent call pays ~30K tokens of
fixed context and the ``datum-cli`` calls run exactly one command. The
definitions therefore carry a strict tool allowlist, a model tier and a
``maxTurns`` cap, and the cheap agents get the tightest caps.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"
AGENT_FILES = sorted(AGENTS_DIR.glob("*.md"))

CHEAP_AGENTS = {
    "datum-cli": {"tools": ["Bash"], "model": "haiku", "maxTurns": 3},
    # 4, not the tighter 2: datum-reader's flagship documented use is
    # lane-plan.json, which can exceed the Read tool's own line-count
    # window on a large plan — it needs headroom for one offset-based
    # continuation read plus the final answer (#524 code review).
    "datum-reader": {"tools": ["Read"], "model": "haiku", "maxTurns": 4},
    "datum-reflect": {"tools": ["Read", "Bash"], "model": "haiku", "maxTurns": 3},
}
STAGE_AGENTS = {"datum-red", "datum-green", "datum-refactor"}
STAGE_MAX_TURNS = 30
REQUIRED_KEYS = ("name", "description", "tools", "model")


def _split(md: Path) -> tuple[dict, str]:
    text = md.read_text()
    assert text.startswith("---\n"), f"{md.name}: no frontmatter"
    _, fm, body = text.split("---\n", 2)
    data = yaml.safe_load(fm)
    assert isinstance(data, dict), f"{md.name}: frontmatter is not a mapping"
    return data, body


def _tools(data: dict) -> list[str]:
    raw = data["tools"]
    if isinstance(raw, list):
        return [str(t) for t in raw]
    return [t.strip() for t in str(raw).split(",") if t.strip()]


def test_agents_dir_has_definitions():
    assert len(AGENT_FILES) >= 8, [p.name for p in AGENT_FILES]


@pytest.mark.parametrize("md", AGENT_FILES, ids=lambda p: p.name)
def test_frontmatter_parses_with_required_keys(md: Path):
    data, body = _split(md)
    for key in REQUIRED_KEYS:
        assert key in data and data[key], f"{md.name}: missing {key}"
    assert data["name"] == md.stem, f"{md.name}: name/filename mismatch"
    assert data["model"] in {"haiku", "sonnet", "opus", "inherit"}, data["model"]
    assert _tools(data), f"{md.name}: empty tools allowlist"
    assert body.strip(), f"{md.name}: empty body"


@pytest.mark.parametrize("md", AGENT_FILES, ids=lambda p: p.name)
def test_description_is_one_line_and_starts_with_when_to_use(md: Path):
    data, _ = _split(md)
    desc = str(data["description"]).strip()
    assert "\n" not in desc, f"{md.name}: description must be one line"
    assert desc.lower().startswith(
        "use "
    ), f"{md.name}: description must start with when to use it ('Use when ...'): {desc!r}"


@pytest.mark.parametrize("md", AGENT_FILES, ids=lambda p: p.name)
def test_no_skills_preload(md: Path):
    data, _ = _split(md)
    assert (
        "skills" not in data
    ), f"{md.name}: skills: preload adds fixed context per call"


@pytest.mark.parametrize("name", sorted(CHEAP_AGENTS), ids=str)
def test_cheap_agents_are_tightly_capped(name: str):
    data, body = _split(AGENTS_DIR / f"{name}.md")
    want = CHEAP_AGENTS[name]
    assert (
        _tools(data) == want["tools"]
    ), f"{name}: tools {_tools(data)} != {want['tools']}"
    assert data["model"] == want["model"]
    assert (
        data.get("maxTurns") == want["maxTurns"]
    ), f"{name}: maxTurns {data.get('maxTurns')}"


def test_cli_body_is_at_most_15_lines_and_says_run_exactly_and_return_json():
    _, body = _split(AGENTS_DIR / "datum-cli.md")
    lines = [ln for ln in body.strip().splitlines() if ln.strip()]
    assert len(lines) <= 15, f"datum-cli body has {len(lines)} non-blank lines"
    text = body.lower()
    assert "exactly" in text
    assert "json" in text


@pytest.mark.parametrize("name", sorted(STAGE_AGENTS), ids=str)
def test_stage_agents_keep_tools_and_get_max_turns(name: str):
    data, _ = _split(AGENTS_DIR / f"{name}.md")
    assert (
        data.get("maxTurns") == STAGE_MAX_TURNS
    ), f"{name}: maxTurns {data.get('maxTurns')}"
    for tool in ("Read", "Write", "Edit", "Bash"):
        assert tool in _tools(data), f"{name}: lost {tool}"
    assert "hooks" in data and data["hooks"].get(
        "PreToolUse"
    ), f"{name}: lost PreToolUse hooks"


def test_skeptic_keeps_read_only_hook():
    data, _ = _split(AGENTS_DIR / "datum-skeptic.md")
    pre = data["hooks"]["PreToolUse"]
    cmds = [h["command"] for entry in pre for h in entry["hooks"]]
    assert any("read-only" in c and "exit 2" in c for c in cmds), cmds
    tools = _tools(data)
    assert "Write" not in tools and "Edit" not in tools
