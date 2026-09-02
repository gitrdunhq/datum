"""Drift guard: every ``agentType`` the workflows name has a definition (#368).

Two sources of references in ``skills/src/**/*.ts``:

1. inline ``agentType: 'datum-red'`` (single or double quotes) anywhere;
2. a stage → agent mapping table in ``skills/src/shared/*.ts``: any
   ``'datum-<x>'`` string literal in a file that mentions ``agentType``,
   minus the compiled skill names (``skills/datum-*.js`` stems, which are
   workflows, not agents).

Assertions (only once at least one reference exists):

- every referenced name has ``agents/<name>.md``;
- every ``agents/*.md`` is referenced at least once, unless listed in
  ``UNREFERENCED_OK`` with a reason.

Until the workflows are wired to pass ``agentType`` the test skips with a
note rather than failing — there is nothing to drift from yet.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = ROOT / "agents"
SRC_DIR = ROOT / "skills" / "src"
SHARED_DIR = SRC_DIR / "shared"
SKILLS_DIR = ROOT / "skills"

# name -> reason it is allowed to have no workflow reference.
UNREFERENCED_OK: dict[str, str] = {}

_INLINE = re.compile(r"""agentType\s*[:=]\s*['"]([A-Za-z0-9_-]+)['"]""")
_LITERAL = re.compile(r"""['"](datum-[a-z][a-z0-9-]*)['"]""")


def _ts_files(base: Path) -> list[Path]:
    return sorted(p for p in base.rglob("*.ts") if not p.name.endswith(".d.ts"))


def _skill_names() -> set[str]:
    return {p.stem for p in SKILLS_DIR.glob("datum-*.js")}


def referenced_agent_types() -> dict[str, set[Path]]:
    """Map of referenced agent name -> files that reference it."""
    refs: dict[str, set[Path]] = {}
    skills = _skill_names()
    for path in _ts_files(SRC_DIR):
        text = path.read_text()
        for m in _INLINE.finditer(text):
            refs.setdefault(m.group(1), set()).add(path)
        if path.parent == SHARED_DIR and "agentType" in text:
            for m in _LITERAL.finditer(text):
                if m.group(1) not in skills:
                    refs.setdefault(m.group(1), set()).add(path)
    return refs


def defined_agent_types() -> set[str]:
    return {p.stem for p in AGENTS_DIR.glob("*.md")}


def test_agents_dir_exists_with_definitions():
    assert defined_agent_types(), f"no agents/*.md under {AGENTS_DIR}"


def test_every_referenced_agent_type_has_a_definition():
    refs = referenced_agent_types()
    if not refs:
        pytest.skip(
            "no agentType references in skills/src yet (the workflows are not "
            "wired to pass agentType); nothing to drift from"
        )
    defined = defined_agent_types()
    missing = {n: sorted(str(p) for p in ps) for n, ps in refs.items() if n not in defined}
    assert not missing, f"agentType referenced without agents/<name>.md: {missing}"


def test_every_definition_is_referenced_or_explicitly_excused():
    refs = referenced_agent_types()
    if not refs:
        pytest.skip(
            "no agentType references in skills/src yet; the 'every definition is "
            "used' half of the drift check applies once the first one lands"
        )
    unreferenced = defined_agent_types() - set(refs) - set(UNREFERENCED_OK)
    assert not unreferenced, (
        f"agents/*.md with no agentType reference in skills/src: {sorted(unreferenced)}. "
        "Wire it or add it to UNREFERENCED_OK with a reason."
    )
    stale_excuses = set(UNREFERENCED_OK) & set(refs)
    assert not stale_excuses, f"UNREFERENCED_OK entries that are now referenced: {sorted(stale_excuses)}"
    assert set(UNREFERENCED_OK) <= defined_agent_types(), "UNREFERENCED_OK names a non-existent agent"
