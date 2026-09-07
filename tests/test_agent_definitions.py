"""Every ``agents/*.md`` is a well-formed, cost-bounded Claude Code agent (#368).

Evidence from a 463-call epic run: each sub-agent call pays ~30K tokens of
fixed context and the ``datum-cli`` calls run exactly one command. The
definitions therefore carry a strict tool allowlist, a model tier and a
``maxTurns`` cap, and the cheap agents get the tightest caps.
"""

from __future__ import annotations

import json
import shutil
import subprocess
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
    # 8, not 3: reflect now reads the lane-spec file, runs git hash-object on
    # it for the read witness, then reads the test file(s) before scoring —
    # at 3 it hit the cap on every lane and every lane went to GREEN unscored.
    # 14, not 8: since the lane spec became a deferred file, reflect must read
    # it, hash it for the witness, read every test file and survive the
    # harness schema retry (caliper eedom wf_4f739141-c8c, a464e08f).
    "datum-reflect": {"tools": ["Read", "Bash"], "model": "haiku", "maxTurns": 14},
    # 12, not 4: the refactor and docs pre-checks read every file a lane
    # touched and answer a rubric. datum-reader ("read one file, return its
    # contents") could not do that in four turns, so the checks silently
    # returned nothing and the optional stages were skipped (prompts audit
    # 20260906, batch 2 item 10). The headroom entries are the operator's
    # local-model runtime path for files over 100 lines; they are hedged on
    # availability in the shared preamble.
    "datum-quality-reader": {
        "tools": [
            "Read",
            "Grep",
            "Glob",
            "mcp__headroom__headroom_compress",
            "mcp__headroom__headroom_retrieve",
        ],
        "model": "haiku",
        "maxTurns": 12,
    },
}
STAGE_AGENTS = {"datum-red", "datum-green", "datum-refactor"}
# wf_b1c88e09-036: a GREEN on a 555-line file spent 30 calls (7 Edits + Reads)
# and was cut off before running tests or committing; the retry hit 30
# again. GREEN needs the most headroom (read → edit → test → commit).
STAGE_MAX_TURNS = {"datum-red": 60, "datum-green": 80, "datum-refactor": 60}
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
        data.get("maxTurns") == STAGE_MAX_TURNS[name]
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


# #494: the lane runner dispatches the skeptic lenses at per-lens tiers
# (skills/src/shared/prompts.ts skepticLenses — edge/error at model('fast'),
# contract at model('balanced')), never at a fixed frontmatter model, so a
# hard-coded "model: sonnet" here was dead metadata the call site never
# honoured.
def test_skeptic_model_is_inherit_not_a_dead_fixed_tier():
    data, body = _split(AGENTS_DIR / "datum-skeptic.md")
    assert data["model"] == "inherit", data["model"]
    assert "per lens" in body.lower() or "per-lens" in body.lower()


# #375: the Review lenses ran with no read-only protection. The Architecture
# lens ran `git checkout <other branch>` in the operator's main checkout, so
# the diff, the synthesis and the committed REVIEW-REPORT.md were all for the
# wrong branch. datum-reviewer.md is the read-only definition the lenses run
# under; unlike datum-skeptic it must also block *Bash* mutation, because the
# defect arrived through Bash and not through Edit/Write.
HOOKS_DIR = AGENTS_DIR.parent / "assets" / "hooks"
READ_ONLY_BASH_HOOK = "pre-tool-use-read-only-bash.sh"


def test_reviewer_is_read_only_in_tools_and_hooks():
    data, body = _split(AGENTS_DIR / "datum-reviewer.md")
    tools = _tools(data)
    assert "Write" not in tools and "Edit" not in tools, tools
    assert "Read" in tools and "Bash" in tools and "Grep" in tools, tools
    # the tier is chosen per lens at the call site (#494), never fixed here
    assert data["model"] == "inherit", data["model"]

    pre = data["hooks"]["PreToolUse"]
    matchers = {entry["matcher"] for entry in pre}
    assert "Edit|Write" in matchers, matchers
    assert "Bash" in matchers, matchers
    cmds = [h["command"] for entry in pre for h in entry["hooks"]]
    assert any("read-only" in c and "exit 2" in c for c in cmds), cmds
    assert any(READ_ONLY_BASH_HOOK in c for c in cmds), cmds
    assert "read-only" in body.lower()


@pytest.mark.skipif(shutil.which("jq") is None, reason="hook needs jq")
@pytest.mark.parametrize(
    "command,blocked",
    [
        ("git checkout other-branch", True),
        ("git switch main", True),
        ("git reset --hard HEAD~1", True),
        ("git commit -m 'x'", True),
        ("git worktree add /tmp/x", True),
        ("cd repo && git rebase main", True),
        ("rm -rf src", True),
        ("sed -i '' 's/a/b/' src/x.ts", True),
        ("git diff --stat main...HEAD", False),
        ("git log --oneline -5", False),
        ("git show HEAD", False),
        ("git rev-parse --abbrev-ref HEAD", False),
        ("git merge-base HEAD main", False),
        ("rg 'checkout' src", False),
    ],
)
def test_read_only_bash_hook_blocks_mutation_and_allows_inspection(
    command: str, blocked: bool
):
    hook = HOOKS_DIR / READ_ONLY_BASH_HOOK
    proc = subprocess.run(
        [str(hook)],
        input=json.dumps({"tool_input": {"command": command}}),
        capture_output=True,
        text=True,
    )
    if blocked:
        assert proc.returncode == 2, f"{command!r} was allowed: {proc.stdout}"
        assert "BLOCKED" in proc.stderr
    else:
        assert proc.returncode == 0, f"{command!r} was blocked: {proc.stderr}"
